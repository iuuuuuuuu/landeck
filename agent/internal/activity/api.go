package activity

import (
	"fmt"
	"sync"
	"time"
)

// ---------- 查询 API（httpapi 调用的包级入口） ----------
//
// 缓存策略对齐 metrics.CachedHistory：查询结果缓存 3 分钟。
// 统计是重读轻写的场景（读:图表轮询/切页，写:30s 一条 UPDATE），
// 缓存条目按 (kind, scope, date, app, limit) 区分。

const queryTTL = 3 * time.Minute

type cacheEntry struct {
	at    time.Time
	value any
}

var (
	cacheMu sync.Mutex
	// cacheEpoch 缓存纪元：Start/Stop 各 bump 一次。键里带上它——
	// 测试串行复用进程时（Start→Stop→Start 换了新 DB），旧键不再是
	// 同一份数据（perf 测试缓存被 syncagg 命中过，实测踩过）
	cacheEpoch int
	cache      = map[string]cacheEntry{}
)

func cachedQuery(key string, build func() (any, error)) (any, error) {
	cacheMu.Lock()
	full := fmt.Sprintf("e%d|%s", cacheEpoch, key)
	e, ok := cache[full]
	cacheMu.Unlock()
	if ok && time.Since(e.at) < queryTTL {
		return e.value, nil
	}
	v, err := build()
	if err != nil {
		return nil, err
	}
	cacheMu.Lock()
	// 简单上限：统计查询键空间有限（scope×date），超 256 清空重来
	if len(cache) > 256 {
		cache = map[string]cacheEntry{}
	}
	cache[full] = cacheEntry{at: time.Now(), value: v}
	cacheMu.Unlock()
	return v, nil
}

func withMgr(fn func(m *Manager) (any, error)) (any, error) {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return emptySummary(), errNotStarted
	}
	return fn(m)
}

// Summary 按 scope（day|week|month）与锚点日期返回堆叠统计。
func GetSummary(scope, date, scopeAgg string) (any, error) {
	// 未知 scope 必须显式报错：静默回退「一天」= 假 200，
	// 全部历史页据此渲染了垃圾数据（集成实测事故）
	switch scope {
	case "day", "week", "month", "year":
	default:
		return nil, fmt.Errorf("%w: 未知 scope %q", ErrBadScope, scope)
	}
	switch scopeAgg {
	case "", "all": // 默认只看本机；all=本机+同步视图合并统计（十期 A1）
	default:
		return nil, fmt.Errorf("%w: 未知 scopeAgg %q", ErrBadScope, scopeAgg)
	}
	return cachedQuery("summary|"+scopeAgg+"|"+scope+"|"+date, func() (any, error) {
		return withMgr(func(m *Manager) (any, error) {
			from, to, _, _, err := rangeOf(scope, date, time.Now())
			if err != nil {
				return nil, err
			}
			segs, err := m.db.rangeSegs(from.Unix(), to.Unix())
			if err != nil {
				return nil, err
			}
			if scopeAgg == "all" {
				segs = append(segs, SyncSegsInRange(from.Unix(), to.Unix())...)
			}
			sum := BuildSummary(segs, m.settings.Get().Categories, scope, from, to)
			sum.Date = date
			return sum, nil
		})
	})
}

// Rank 应用与分类排行。
func GetRank(scope string, limit int, date string, scopeAgg string) (any, error) {
	switch scope {
	case "day", "week", "month", "year":
	default:
		return nil, fmt.Errorf("%w: 未知 scope %q", ErrBadScope, scope)
	}
	switch scopeAgg {
	case "", "all":
	default:
		return nil, fmt.Errorf("%w: 未知 scopeAgg %q", ErrBadScope, scopeAgg)
	}
	return cachedQuery("rank|"+scopeAgg+"|"+scope+"|"+date, func() (any, error) {
		return withMgr(func(m *Manager) (any, error) {
			from, to, _, _, err := rangeOf(scope, date, time.Now())
			if err != nil {
				return nil, err
			}
			segs, err := m.db.rangeSegs(from.Unix(), to.Unix())
			if err != nil {
				return nil, err
			}
			if scopeAgg == "all" {
				segs = append(segs, SyncSegsInRange(from.Unix(), to.Unix())...)
			}
			return BuildRank(segs, m.settings.Get().Categories, scope, from, to, limit), nil
		})
	})
}

// AppDetail 单应用下钻（按窗口标题分组）。
func GetAppDetail(appName, date string) (any, error) {
	return cachedQuery("detail|"+appName+"|"+date, func() (any, error) {
		return withMgr(func(m *Manager) (any, error) {
			from, to, _, _, err := rangeOf("day", date, time.Now())
			if err != nil {
				return nil, err
			}
			segs, err := m.db.rangeSegs(from.Unix(), to.Unix())
			if err != nil {
				return nil, err
			}
			return BuildAppDetail(segs, m.settings.Get().Categories, appName, from, to), nil
		})
	})
}

// GetSettings 当前设置。
func GetSettings() Settings {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return DefaultSettings()
	}
	return m.settings.Get()
}

// UpdateSettings 原子更新设置。fn 里改字段即可。
func UpdateSettings(fn func(*Settings)) error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return errNotStarted
	}
	return m.settings.Update(fn)
}

// emptySummary 未启动时的空响应（shape 稳定，前端不用判空分支）。
func emptySummary() any {
	return Summary{Scope: "day", Buckets: []Bucket{}, Categories: []CategoryTotal{}}
}
