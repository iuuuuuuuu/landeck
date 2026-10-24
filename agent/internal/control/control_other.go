//go:build !windows && !linux && !darwin

package control

import "time"

type unsupported struct{ opts Options }

func New(opts Options) Controller { return &unsupported{opts: opts} }

func (u *unsupported) Caps() Caps     { return Caps{} }
func (u *unsupported) DryRun() bool   { return u.opts.DryRun }
func (u *unsupported) Power(string, int, bool) error { return ErrUnsupported }
func (u *unsupported) Volume(string, int) (VolumeState, error) { return VolumeState{}, ErrUnsupported }
func (u *unsupported) VolumeState() (VolumeState, error)       { return VolumeState{}, ErrUnsupported }
func (u *unsupported) Media(string) error                      { return ErrUnsupported }
func (u *unsupported) MediaState() (MediaInfo, error)          { return MediaInfo{}, ErrUnsupported }
func (u *unsupported) Wake(mac string) error                   { return sendMagicPacket(mac) }

func WakeAlarmAt(time.Time, string) error { return ErrUnsupported }
func CancelWakeAlarm(string)              {}
