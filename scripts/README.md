# Development Scripts

This directory contains utility scripts for maintaining and analyzing the Token Nerd codebase.

## Scripts

### complexity-analyzer.sh

A comprehensive code complexity analysis tool that evaluates TypeScript files based on multiple metrics:

**Metrics Analyzed:**
- Lines of Code (LOC)
- Cyclomatic Complexity (branches)
- Function/Class Count
- Import Dependencies
- Nesting Depth

**Scoring System:**
- **🟢 1-2/10**: Simple, well-maintained files
- **🟡 3-4/10**: Moderate complexity
- **🟠 5-8/10**: High complexity, consider refactoring
- **🔴 9-10/10**: Very complex, needs immediate attention

#### Usage Examples

```bash
# Analyze all files in src directory (default)
./scripts/complexity-analyzer.sh

# Analyze specific directory
./scripts/complexity-analyzer.sh src/lib

# Get detailed analysis for each file
VERBOSE=1 ./scripts/complexity-analyzer.sh src

# Analyze a single file in detail
./scripts/complexity-analyzer.sh --file src/lib/tui-components.ts

# Quick check on current lib files
./scripts/complexity-analyzer.sh src/lib
```

#### Sample Output

```
========================================
    TypeScript Complexity Analyzer
========================================

Analyzing directory: src/lib

========================================
        COMPLEXITY SUMMARY TABLE
========================================
File                          LOC      Branches   Score    Rating       Status
------------------------------------------------------------------------
tui-components.ts             1084     42         65       9-10/10 🔴   ⚠️  Refactor
jsonl-utils.ts                291      34         38       7-8/10 🟠    📋 Plan  
correlation-engine.ts         142      15         18       3-4/10 🟡    ✅ Good
session-tracker.ts            33       3          5        1-2/10 🟢    ✅ Good

========================================
Legend:
  🟢 1-2/10  = Simple, well-maintained
  🟡 3-4/10  = Moderate complexity
  🟠 5-8/10  = High complexity, consider refactoring
  🔴 9-10/10 = Very complex, needs immediate attention

Run with VERBOSE=1 for detailed file analysis
========================================
```

#### Integration with Development Workflow

**Pre-commit Hook:**
```bash
# Add to .git/hooks/pre-commit
./scripts/complexity-analyzer.sh src | grep "🔴\|⚠️" && echo "High complexity files detected" && exit 1
```

**CI/CD Integration:**
```yaml
# GitHub Actions example
- name: Check Code Complexity
  run: |
    ./scripts/complexity-analyzer.sh src
    HIGH_COMPLEXITY=$(./scripts/complexity-analyzer.sh src | grep -c "🔴")
    if [ $HIGH_COMPLEXITY -gt 0 ]; then
      echo "Found $HIGH_COMPLEXITY files with very high complexity"
      exit 1
    fi
```

**Regular Monitoring:**
```bash
# Weekly complexity report
./scripts/complexity-analyzer.sh src > complexity-report-$(date +%Y-%m-%d).txt
```

#### Complexity Scoring Algorithm

The tool uses a weighted scoring system:

```
Total Score = (LOC_score × 2) + (Branches × 3) + (Functions × 1) + (Imports × 1) + (Nesting × 1)

Where:
- LOC_score: 1 (<100), 3 (100-250), 5 (250-500), 8 (500+)
- Branches: if/else/case/while/for/catch/ternary count
- Functions: function/class/arrow function count
- Imports: import statement count
- Nesting: maximum indentation depth
```

#### Refactoring Recommendations

**Score 50+ (🔴)**: Immediate refactoring needed
- Break into multiple files
- Extract reusable components
- Separate concerns (UI, logic, data)

**Score 35-49 (🟠)**: Plan refactoring
- Identify large functions to split
- Look for repeated patterns to extract
- Consider architectural improvements

**Score 20-34 (🟡)**: Monitor for growth
- Watch for new complexity additions
- Keep functions focused and small

**Score < 20 (🟢)**: Good state
- Maintain current practices
- Continue following established patterns

## Adding New Scripts

When adding new development scripts:

1. Make them executable: `chmod +x scripts/new-script.sh`
2. Add shebang line: `#!/bin/bash`
3. Include usage documentation in this README
4. Follow the existing naming convention (kebab-case)
5. Add error handling and help text

## Environment Requirements

- Bash 4.0+ (for associative arrays)
- Standard Unix tools: `grep`, `wc`, `awk`, `find`
- Works on Linux and macOS

## Contributing

When modifying scripts:
- Test on both small and large codebases
- Maintain backward compatibility
- Update this README with any new features
- Consider performance impact for large projects