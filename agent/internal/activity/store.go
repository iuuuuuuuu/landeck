package activity

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // 纯 Go SQLite 驱动：项目 CGO_ENABLED=0 交叉编译，禁 cgo
)

// Segment 一段连续的前台使用。start/end 为 unix 秒。
//
// 库里不存 category：分类规则可被 API 修改，查询时按当前规则现算，
// 改规则立即修正全部历史（见包注释）。
type Segment struct {
	App   string
	Title string
	Start int64
	End   int64
}

// Dur 返回段时长（秒，可能是 0）。
func (s Segment) Dur() int64 {
	d := s.End - s.Start
	if d < 0 {
		return 0
	}
	return d
}

// clip 把段裁剪到 [from, to)，返回裁剪后的时长（秒）。
// 跨天/跨查询边界的段在这里被切开 —— 聚合函数不用再关心边界。
func (s Segment) clip(from, to int64) Segment {
	if s.Start < from {
		s.Start = from
	}
	if s.End > to {
		s.End = to
	}
	return s
}

// dayOf 段开始时刻的本地日期（YYYY-MM-DD）。
// 用本地时区：用户问「今天用了多久」指的是本地自然日。
func dayOf(unix int64) string {
	return time.Unix(unix, 0).Format("2006-01-02")
}

const titleMaxRunes = 200 // 标题截断，防个别窗口的超长标题撑大库

func clipTitle(t string) string {
	r := []rune(strings.TrimSpace(t))
	if len(r) > titleMaxRunes {
		r = r[:titleMaxRunes]
	}
	return string(r)
}

// openDB 打开（必要时创建）段库。WAL 模式：写不阻塞读。
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// modernc/sqlite 是单写者：库级串行化交给 Go 侧 mutex（见 segmentStore），
	// 连接池限制为 1 写连接即可，避免 SQLITE_BUSY。
	db.SetMaxOpenConns(1)
	const schema = `
CREATE TABLE IF NOT EXISTS segments (
	id    INTEGER PRIMARY KEY AUTOINCREMENT,
	day   TEXT    NOT NULL,           -- 开始时刻的本地日期，冗余列：按天清理与查询加速
	start INTEGER NOT NULL,           -- unix 秒
	end   INTEGER NOT NULL,
	app   TEXT    NOT NULL,
	title TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_segments_start ON segments(start);
CREATE INDEX IF NOT EXISTS idx_segments_day   ON segments(day);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("初始化段库失败: %w", err)
	}
	return db, nil
}

// segmentStore 段库的线程安全封装。
// 写路径是采集循环（30s 一次）+ 清理（每天一次），读路径是查询（带缓存），
// 量都很小，库级 mutex 足够，不需要上 WAL 以外的花活。
type segmentStore struct {
	db *sql.DB
}

// insert 写入新段。
func (s *segmentStore) insert(seg Segment) error {
	_, err := s.db.Exec(`INSERT INTO segments(day, start, "end", app, title) VALUES(?,?,?,?,?)`,
		dayOf(seg.Start), seg.Start, seg.End, seg.App, seg.Title)
	return err
}

// extend 把 segID 段的结束时间推到 end（同一应用连续采样时每 30s 调一次）。
func (s *segmentStore) extend(id int64, end int64) error {
	_, err := s.db.Exec(`UPDATE segments SET "end"=? WHERE id=?`, end, id)
	return err
}

// closeOpen 把一段落库并返回其 id。end<=start 的段没有信息量，跳过。
func (s *segmentStore) closeOpen(seg openSegment) (int64, error) {
	if seg.ID != 0 {
		if err := s.extend(seg.ID, seg.End); err != nil {
			return seg.ID, err
		}
		return seg.ID, nil
	}
	if seg.End <= seg.Start {
		return 0, nil
	}
	r, err := s.db.Exec(`INSERT INTO segments(day, start, "end", app, title) VALUES(?,?,?,?,?)`,
		dayOf(seg.Start), seg.Start, seg.End, seg.App, seg.Title)
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

// rangeSegs 返回与 [from, to) 有交集的全部段（可能包含边界外的部分，聚合时裁剪）。
func (s *segmentStore) rangeSegs(from, to int64) ([]Segment, error) {
	rows, err := s.db.Query(`SELECT app, title, start, "end" FROM segments WHERE start < ? AND "end" > ? ORDER BY start`, to, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Segment, 0, 64)
	for rows.Next() {
		var g Segment
		if err := rows.Scan(&g.App, &g.Title, &g.Start, &g.End); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// prune 删除 N 天前的段。启动与每日各跑一次。
func (s *segmentStore) prune(days int, now time.Time) (int64, error) {
	cut := now.AddDate(0, 0, -days).Unix()
	r, err := s.db.Exec(`DELETE FROM segments WHERE "end" < ?`, cut)
	if err != nil {
		return 0, err
	}
	return r.RowsAffected()
}

// count 返回总段数（诊断用）。
func (s *segmentStore) count() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM segments`).Scan(&n)
	return n, err
}
