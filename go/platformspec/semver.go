package platformspec

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	maxSemverLength          = 256
	maxDependencyRangeLength = 512
	maxDependencyClauses     = 16
)

var strictSemverPattern = regexp.MustCompile(`^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
var dependencyClausePattern = regexp.MustCompile(`^(\^|~|>=|<=|>|<|=)?(.+)$`)

func DependencyRequirementSatisfied(version, requirement string) (bool, error) {
	if !strictSemver(version) {
		return false, fmt.Errorf("invalid strict SemVer version")
	}
	clauses, err := dependencyClauses(requirement)
	if err != nil {
		return false, err
	}
	matched := true
	for _, clause := range clauses {
		ok, err := dependencyClauseSatisfied(version, clause)
		if err != nil {
			return false, err
		}
		if !ok {
			matched = false
		}
	}
	if matched && semver.Prerelease("v"+version) != "" {
		matched = false
		for _, clause := range clauses {
			if clauseNamesSameCorePrerelease(version, clause) {
				matched = true
				break
			}
		}
	}
	return matched, nil
}

func strictSemver(value string) bool {
	return len(value) > 0 && len(value) <= maxSemverLength && strictSemverPattern.MatchString(value)
}

func dependencyClauses(requirement string) ([]string, error) {
	if requirement == "" || len(requirement) > maxDependencyRangeLength || requirement != strings.TrimSpace(requirement) || strings.Contains(requirement, "||") || requirement == "*" {
		return nil, fmt.Errorf("invalid dependency requirement")
	}
	clauses := strings.Split(requirement, " ")
	if len(clauses) == 0 || len(clauses) > maxDependencyClauses {
		return nil, fmt.Errorf("invalid dependency requirement")
	}
	for _, clause := range clauses {
		match := dependencyClausePattern.FindStringSubmatch(clause)
		if clause == "" || clause == "*" || match == nil || !strictSemver(match[2]) {
			return nil, fmt.Errorf("invalid dependency requirement")
		}
	}
	return clauses, nil
}

func dependencyClauseSatisfied(version, clause string) (bool, error) {
	match := dependencyClausePattern.FindStringSubmatch(clause)
	if match == nil || !strictSemver(match[2]) {
		return false, fmt.Errorf("invalid dependency clause")
	}
	operator := match[1]
	if operator == "" {
		operator = "="
	}
	compared := semver.Compare("v"+version, "v"+match[2])
	switch operator {
	case "^", "~":
		upper, err := dependencyUpperBound(match[2], operator)
		return compared >= 0 && semver.Compare("v"+version, "v"+upper) < 0, err
	case ">=":
		return compared >= 0, nil
	case ">":
		return compared > 0, nil
	case "<=":
		return compared <= 0, nil
	case "<":
		return compared < 0, nil
	case "=":
		return compared == 0, nil
	default:
		return false, fmt.Errorf("unsupported dependency operator")
	}
}

func dependencyUpperBound(value, operator string) (string, error) {
	core := strings.SplitN(strings.SplitN(value, "+", 2)[0], "-", 2)[0]
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid dependency boundary")
	}
	numbers := make([]*big.Int, 3)
	for index, part := range parts {
		numbers[index] = new(big.Int)
		if _, ok := numbers[index].SetString(part, 10); !ok {
			return "", fmt.Errorf("invalid dependency boundary")
		}
	}
	one := big.NewInt(1)
	if operator == "~" {
		numbers[1].Add(numbers[1], one)
		numbers[2].SetInt64(0)
	} else if numbers[0].Sign() > 0 {
		numbers[0].Add(numbers[0], one)
		numbers[1].SetInt64(0)
		numbers[2].SetInt64(0)
	} else if numbers[1].Sign() > 0 {
		numbers[1].Add(numbers[1], one)
		numbers[2].SetInt64(0)
	} else {
		numbers[2].Add(numbers[2], one)
	}
	return numbers[0].String() + "." + numbers[1].String() + "." + numbers[2].String(), nil
}

func clauseNamesSameCorePrerelease(version, clause string) bool {
	match := dependencyClausePattern.FindStringSubmatch(clause)
	if match == nil || semver.Prerelease("v"+match[2]) == "" {
		return false
	}
	versionCore := strings.SplitN(strings.SplitN(version, "+", 2)[0], "-", 2)[0]
	clauseCore := strings.SplitN(strings.SplitN(match[2], "+", 2)[0], "-", 2)[0]
	return versionCore == clauseCore
}
