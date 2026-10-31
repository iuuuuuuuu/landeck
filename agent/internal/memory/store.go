package memory

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite" // 纯 Go 驱动，与 activity 同款（CGO_ENABLED=0 兼容）
)

// shots 表：复用 activity 的 activity.db 文件（modernc SQLite，独立表、独立连接）。
//
// 为什么是独立连接而不是共享 *sql.DB：跨包暴露底层连接会把两个包焊死；
// WAL 模式 + busy_timeout 下多连接并发读写是 SQLite 的正常形态，
// 两边写频（activity 30s 一次、memory 60s 一次）远够不着锁竞争。
//
// 字段按契约：id, ts(unix 秒), app, ocr, file。file 只存文件名（不含目录）——
// 库里泄露绝对路径没有任何好处，导出/展示都只需要 id 换图。
// ocrLang 契约的采集节里提到但表结构没给列：文本才是检索对象，
// 语言标签丢弃（要加是一列 ALTER 的事，见交付说明）。
type shotStore struct {
	db *sql.DB
}

func openShotStore(path string) (*shotStore, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // 单写者，串行化交给连接池
	const schema = `
CREATE TABLE IF NOT EXISTS shots (
	id      INTEGER PRIMARY KEY AUTOINCREMENT,
	ts      INTEGER NOT NULL,           -- unix 秒
	app     TEXT    NOT NULL DEFAULT '',
	ocr     TEXT    NOT NULL DEFAULT '',  -- OCR 原文（snippet 展示用）
	ocrNorm TEXT    NOT NULL DEFAULT '',  -- 去空白副本（检索用，见下）
	file    TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_shots_ts ON shots(ts);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("初始化 shots 表失败: %w", err)
	}
	// 老库升级：v1 早期表没有 ocrNorm 列（漂移容忍的 ALTER，已存在则忽略）
	_, _ = db.Exec(`ALTER TABLE shots ADD COLUMN ocrNorm TEXT NOT NULL DEFAULT ''`)
	return &shotStore{db: db}, nil
}

// insert 落一张截图的元数据，返回 id（OCR 结果稍后 UPDATE 回来）。
func (s *shotStore) insert(ts int64, app, file string) (int64, error) {
	r, err := s.db.Exec(`INSERT INTO shots(ts, app, ocr, file) VALUES(?,?,'',?)`, ts, app, file)
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

// setOCR 把 OCR 结果回填到行。ocr 存原文，ocrNorm 存去空白副本——
// OCR 输出常在字间插空格（"网 易 名 乐"），不归一的话搜「网易」永远
// LIKE 不中（实测踩过）；snippet 仍从原文取，展示可读。
func (s *shotStore) setOCR(id int64, text string) error {
	_, err := s.db.Exec(`UPDATE shots SET ocr=?, ocrNorm=? WHERE id=?`, text, normForSearch(text), id)
	return err
}

// normForSearch 检索归一：去掉全部空白（含 OCR 插入的字间空格）。
func normForSearch(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case ' ', '\t', '\n', '\r', '\u3000':
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// search LIKE 检索（契约 v1 口径，不做 FTS）。from/to 为 unix 秒（0 = 不限）。
func (s *shotStore) search(q string, from, to int64, limit int) ([]SearchItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	// ESCAPE '\\'：配合 escapeLike，用户搜 "50%" 不会变成通配
	like := "%" + escapeLike(normForSearch(q)) + "%"
	const likeEsc = `LIKE ? ESCAPE '\'`
	qs := `SELECT id, ts, app, ocr, file FROM shots WHERE ocrNorm ` + likeEsc
	args := []any{like}
	if from > 0 {
		qs += ` AND ts >= ?`
		args = append(args, from)
	}
	if to > 0 {
		qs += ` AND ts <= ?`
		args = append(args, to)
	}
	qs += ` ORDER BY ts DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(qs, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SearchItem, 0, 16)
	for rows.Next() {
		var it SearchItem
		var text string
		if err := rows.Scan(&it.ID, &it.Ts, &it.App, &text, &it.File); err != nil {
			return nil, err
		}
		it.Snippet = buildSnippet(text, q)
		out = append(out, it)
	}
	return out, rows.Err()
}

// get 供 image 端点取文件名。
func (s *shotStore) get(id int64) (file string, ok bool) {
	err := s.db.QueryRow(`SELECT file FROM shots WHERE id=?`, id).Scan(&file)
	if err != nil || file == "" {
		return "", false
	}
	return file, true
}

// pruneBefore 删 N 天前的行并返回涉及文件名（文件由调用方删盘）。
func (s *shotStore) pruneBefore(cut int64) ([]string, int64, error) {
	rows, err := s.db.Query(`SELECT file FROM shots WHERE ts < ?`, cut)
	if err != nil {
		return nil, 0, err
	}
	var files []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err == nil && f != "" {
			files = append(files, f)
		}
	}
	rows.Close()
	r, err := s.db.Exec(`DELETE FROM shots WHERE ts < ?`, cut)
	if err != nil {
		return nil, 0, err
	}
	n, _ := r.RowsAffected()
	return files, n, nil
}

// stats 状态端点的计数。
func (s *shotStore) stats() (count int64, lastTs int64) {
	_ = s.db.QueryRow(`SELECT COUNT(*), COALESCE(MAX(ts),0) FROM shots`).Scan(&count, &lastTs)
	return
}

// escapeLike 把 LIKE 通配符转义，防 %/_ 被用户关键词劫持。
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
