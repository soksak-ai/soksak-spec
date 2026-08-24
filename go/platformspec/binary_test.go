package platformspec

import (
	"encoding/binary"
	"testing"
)

func nativeBinaryFixture(target string) []byte {
	switch target {
	case "aarch64-apple-darwin", "x86_64-apple-darwin":
		value := make([]byte, 32)
		binary.LittleEndian.PutUint32(value, 0xfeedfacf)
		cpu := uint32(0x0100000c)
		if target == "x86_64-apple-darwin" {
			cpu = 0x01000007
		}
		binary.LittleEndian.PutUint32(value[4:], cpu)
		return value
	case "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu":
		value := make([]byte, 64)
		copy(value, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
		machine := uint16(183)
		if target == "x86_64-unknown-linux-gnu" {
			machine = 62
		}
		binary.LittleEndian.PutUint16(value[18:], machine)
		return value
	case "x86_64-pc-windows-msvc":
		value := make([]byte, 256)
		copy(value, "MZ")
		binary.LittleEndian.PutUint32(value[0x3c:], 0x80)
		copy(value[0x80:], []byte{'P', 'E', 0, 0})
		binary.LittleEndian.PutUint16(value[0x84:], 0x8664)
		binary.LittleEndian.PutUint16(value[0x98:], 0x20b)
		return value
	default:
		panic("unsupported fixture target")
	}
}

func TestNativeBinaryTargetMatchesEveryReleaseTarget(t *testing.T) {
	for target := range nativeTargets {
		if err := ValidateNativeBinaryTarget(target, nativeBinaryFixture(target)); err != nil {
			t.Errorf("%s: %v", target, err)
		}
	}
}

func TestNativeBinaryTargetRejectsAnotherArchitecture(t *testing.T) {
	if err := ValidateNativeBinaryTarget("aarch64-apple-darwin", nativeBinaryFixture("x86_64-apple-darwin")); err == nil {
		t.Fatal("x86_64 Mach-O accepted as aarch64")
	}
	if err := ValidateNativeBinaryTarget("aarch64-unknown-linux-gnu", nativeBinaryFixture("x86_64-unknown-linux-gnu")); err == nil {
		t.Fatal("x86_64 ELF accepted as aarch64")
	}
}
