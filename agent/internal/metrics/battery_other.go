//go:build !windows && !linux && !darwin

package metrics

func readBattery() *BatteryStat { return nil }
