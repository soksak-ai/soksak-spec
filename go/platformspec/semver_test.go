package platformspec

import "testing"

func TestDependencyRequirementMatchesCanonicalRangeSubset(t *testing.T) {
	tests := []struct {
		version     string
		requirement string
		want        bool
	}{
		{"0.0.1", "0.0.1", true},
		{"0.0.2", "0.0.1", false},
		{"1.4.9", ">=1.4.0 <2.0.0", true},
		{"2.0.0", ">=1.4.0 <2.0.0", false},
		{"1.8.0", "^1.4.0", true},
		{"2.0.0", "^1.4.0", false},
		{"0.2.9", "^0.2.3", true},
		{"0.3.0", "^0.2.3", false},
		{"0.0.4", "^0.0.3", false},
		{"1.4.9", "~1.4.0", true},
		{"1.5.0", "~1.4.0", false},
		{"1.4.0-beta.2", ">=1.4.0-beta.1 <1.4.0", true},
		{"1.4.0-beta.2", ">=1.3.0 <2.0.0", false},
		{"1.4.0+build.7", "1.4.0", true},
	}
	for _, test := range tests {
		got, err := DependencyRequirementSatisfied(test.version, test.requirement)
		if err != nil {
			t.Errorf("%s in %s: %v", test.version, test.requirement, err)
			continue
		}
		if got != test.want {
			t.Errorf("%s in %s = %v, want %v", test.version, test.requirement, got, test.want)
		}
	}
}

func TestDependencyRequirementRejectsUnsupportedSyntax(t *testing.T) {
	for _, requirement := range []string{"", "*", "1.x", "latest", "^1.0.0 || ^2.0.0", " >=1.0.0", "1.0.0  <2.0.0"} {
		if _, err := DependencyRequirementSatisfied("1.0.0", requirement); err == nil {
			t.Errorf("accepted requirement %q", requirement)
		}
	}
	for _, version := range []string{"v1.0.0", "01.0.0", "1.0", "1.0.0-01"} {
		if _, err := DependencyRequirementSatisfied(version, "1.0.0"); err == nil {
			t.Errorf("accepted version %q", version)
		}
	}
}
