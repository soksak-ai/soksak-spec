package platformspec

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

// ValidateNativeBinaryTarget verifies the executable header owned by a sidecar target.
func ValidateNativeBinaryTarget(target string, body []byte) error {
	expectedArchitecture := "x86_64"
	if strings.HasPrefix(target, "aarch64-") {
		expectedArchitecture = "arm64"
	}
	format := ""
	architecture := "unknown"
	switch {
	case strings.HasSuffix(target, "apple-darwin"):
		if len(body) < 8 || binary.LittleEndian.Uint32(body) != 0xfeedfacf {
			return fmt.Errorf("binary target %s: thin 64-bit Mach-O required", target)
		}
		format = "mach-o"
		switch binary.LittleEndian.Uint32(body[4:]) {
		case 0x0100000c:
			architecture = "arm64"
		case 0x01000007:
			architecture = "x86_64"
		}
	case strings.Contains(target, "unknown-linux"):
		if len(body) < 20 || !bytes.Equal(body[:4], []byte{0x7f, 'E', 'L', 'F'}) || body[4] != 2 || body[5] != 1 {
			return fmt.Errorf("binary target %s: little-endian ELF64 required", target)
		}
		format = "elf"
		switch binary.LittleEndian.Uint16(body[18:]) {
		case 183:
			architecture = "arm64"
		case 62:
			architecture = "x86_64"
		}
	case target == "x86_64-pc-windows-msvc":
		if len(body) < 0x40 || !bytes.Equal(body[:2], []byte("MZ")) {
			return fmt.Errorf("binary target %s: PE32+ required", target)
		}
		pe := int(binary.LittleEndian.Uint32(body[0x3c:]))
		if pe < 0 || pe > len(body)-26 || !bytes.Equal(body[pe:pe+4], []byte{'P', 'E', 0, 0}) ||
			binary.LittleEndian.Uint16(body[pe+24:]) != 0x20b {
			return fmt.Errorf("binary target %s: PE32+ signature required", target)
		}
		format = "pe"
		if binary.LittleEndian.Uint16(body[pe+4:]) == 0x8664 {
			architecture = "x86_64"
		}
	default:
		return fmt.Errorf("binary target %s: unsupported target", target)
	}
	if architecture != expectedArchitecture {
		return fmt.Errorf("binary target %s: %s architecture %s, want %s", target, format, architecture, expectedArchitecture)
	}
	return nil
}
