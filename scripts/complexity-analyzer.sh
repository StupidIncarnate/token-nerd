#!/bin/bash

# complexity-analyzer.sh
# Analyzes TypeScript files for complexity metrics and generates ratings

# Color codes for output
RED='\033[0;31m'
ORANGE='\033[0;33m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Function to calculate complexity score and rating
calculate_rating() {
    local score=$1
    local rating=""
    local color=""
    local emoji=""
    
    if [ $score -lt 10 ]; then
        rating="1-2/10"
        color=$GREEN
        emoji="🟢"
    elif [ $score -lt 20 ]; then
        rating="3-4/10"
        color=$YELLOW
        emoji="🟡"
    elif [ $score -lt 35 ]; then
        rating="5-6/10"
        color=$ORANGE
        emoji="🟠"
    elif [ $score -lt 50 ]; then
        rating="7-8/10"
        color=$ORANGE
        emoji="🟠"
    else
        rating="9-10/10"
        color=$RED
        emoji="🔴"
    fi
    
    echo -e "${color}${rating}${NC} ${emoji}"
}

# Function to analyze a single file
analyze_file() {
    local file=$1
    local filename=$(basename "$file")
    
    # Skip test files
    if [[ "$filename" == *".test.ts" ]] || [[ "$filename" == *".spec.ts" ]]; then
        return
    fi
    
    # Check if file exists
    if [ ! -f "$file" ]; then
        return
    fi
    
    # Calculate metrics (ensure clean integer values)
    local loc=$(wc -l < "$file" 2>/dev/null | tr -d ' \n' | sed 's/[^0-9]//g' || echo 0)
    local branches=$(grep -c "if \|else\|case \|while\|for \|catch \|\\?" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
    local functions=$(grep -c "function \|class \|=> \|private.*(" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
    local imports=$(grep -c "^import \|^const.*require" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
    local max_indent=$(awk '{match($0, /^[ \t]*/); if (RLENGTH > max) max = RLENGTH} END {print int(max/2)}' "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
    
    # Ensure empty values become 0
    loc=${loc:-0}
    branches=${branches:-0}
    functions=${functions:-0}
    imports=${imports:-0}
    max_indent=${max_indent:-0}
    
    # Calculate component scores (with safe variable handling)
    local loc_score=0
    if [ "${loc:-0}" -lt 100 ]; then
        loc_score=1
    elif [ "${loc:-0}" -lt 250 ]; then
        loc_score=3
    elif [ "${loc:-0}" -lt 500 ]; then
        loc_score=5
    else
        loc_score=8
    fi
    
    local branch_score=0
    if [ "${branches:-0}" -lt 10 ]; then
        branch_score=1
    elif [ "${branches:-0}" -lt 20 ]; then
        branch_score=3
    elif [ "${branches:-0}" -lt 40 ]; then
        branch_score=5
    else
        branch_score=8
    fi
    
    local import_score=0
    if [ "${imports:-0}" -lt 4 ]; then
        import_score=1
    elif [ "${imports:-0}" -lt 8 ]; then
        import_score=2
    elif [ "${imports:-0}" -lt 12 ]; then
        import_score=3
    else
        import_score=4
    fi
    
    # Calculate total score using weighted formula
    local total_score=$(( (loc_score * 2) + (branch_score * 3) + (${functions:-0} * 1) + (import_score * 1) + (${max_indent:-0} * 1) ))
    
    # Get rating
    local rating=$(calculate_rating $total_score)
    
    # Determine if refactoring is needed
    local recommendation=""
    if [ $total_score -ge 50 ]; then
        recommendation="⚠️  URGENT: Needs immediate refactoring"
    elif [ $total_score -ge 35 ]; then
        recommendation="📋 Plan refactoring soon"
    elif [ $total_score -ge 20 ]; then
        recommendation="👀 Monitor for growth"
    else
        recommendation="✅ Good state"
    fi
    
    # Output results
    echo "----------------------------------------"
    echo "File: $filename"
    echo "Path: $file"
    echo ""
    echo "Metrics:"
    echo "  Lines of Code:    $loc"
    echo "  Branches:         $branches"
    echo "  Functions:        $functions"
    echo "  Imports:          $imports"
    echo "  Max Nesting:      $max_indent levels"
    echo ""
    echo "Complexity Score: $total_score"
    echo "Rating:          $rating"
    echo "Status:          $recommendation"
}

# Function to generate summary table
generate_summary() {
    echo ""
    echo "========================================"
    echo "        COMPLEXITY SUMMARY TABLE"
    echo "========================================"
    printf "%-30s %-8s %-10s %-8s %-12s %s\n" "File" "LOC" "Branches" "Score" "Rating" "Status"
    echo "------------------------------------------------------------------------"
}

# Main execution
main() {
    local target_dir=${1:-"src"}
    
    echo "========================================"
    echo "    TypeScript Complexity Analyzer"
    echo "========================================"
    echo ""
    echo "Analyzing directory: $target_dir"
    echo ""
    
    # Arrays to store file data for summary
    declare -a files=()
    declare -a locs=()
    declare -a branches_arr=()
    declare -a scores=()
    declare -a ratings=()
    
    # Find and analyze all TypeScript files
    while IFS= read -r file; do
        # Skip test files
        if [[ "$file" == *".test.ts" ]] || [[ "$file" == *".spec.ts" ]]; then
            continue
        fi
        
        # Get metrics for summary (ensure clean integer values)
        local filename=$(basename "$file")
        local loc=$(wc -l < "$file" 2>/dev/null | tr -d ' \n' | sed 's/[^0-9]//g' || echo 0)
        local branches=$(grep -c "if \|else\|case \|while\|for \|catch \|\\?" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
        local functions=$(grep -c "function \|class \|=> \|private.*(" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
        local imports=$(grep -c "^import \|^const.*require" "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
        local max_indent=$(awk '{match($0, /^[ \t]*/); if (RLENGTH > max) max = RLENGTH} END {print int(max/2)}' "$file" 2>/dev/null | sed 's/[^0-9]//g' || echo 0)
        
        # Ensure empty values become 0
        loc=${loc:-0}; loc=${loc:-0}
        branches=${branches:-0}; branches=${branches:-0}
        functions=${functions:-0}; functions=${functions:-0} 
        imports=${imports:-0}; imports=${imports:-0}
        max_indent=${max_indent:-0}; max_indent=${max_indent:-0}
        
        # Calculate score (with safe variable handling)
        local loc_score=0
        if [ "${loc:-0}" -lt 100 ]; then loc_score=1
        elif [ "${loc:-0}" -lt 250 ]; then loc_score=3
        elif [ "${loc:-0}" -lt 500 ]; then loc_score=5
        else loc_score=8; fi
        
        local branch_score=0
        if [ "${branches:-0}" -lt 10 ]; then branch_score=1
        elif [ "${branches:-0}" -lt 20 ]; then branch_score=3
        elif [ "${branches:-0}" -lt 40 ]; then branch_score=5
        else branch_score=8; fi
        
        local import_score=0
        if [ "${imports:-0}" -lt 4 ]; then import_score=1
        elif [ "${imports:-0}" -lt 8 ]; then import_score=2
        elif [ "${imports:-0}" -lt 12 ]; then import_score=3
        else import_score=4; fi
        
        local total_score=$(( (loc_score * 2) + (branch_score * 3) + (${functions:-0} * 1) + (import_score * 1) + (${max_indent:-0} * 1) ))
        
        # Store for summary
        files+=("$filename")
        locs+=("$loc")
        branches_arr+=("$branches")
        scores+=("$total_score")
        
        # Detailed analysis if verbose
        if [ "${VERBOSE:-0}" = "1" ]; then
            analyze_file "$file"
        fi
        
    done < <(find "$target_dir" -name "*.ts" -type f | sort)
    
    # Generate summary table
    generate_summary
    
    # Sort by score and display
    for i in "${!files[@]}"; do
        echo "${scores[$i]}|${files[$i]}|${locs[$i]}|${branches_arr[$i]}"
    done | sort -t'|' -k1 -rn | while IFS='|' read -r score file loc branches; do
        local rating=$(calculate_rating $score)
        local status=""
        
        if [ $score -ge 50 ]; then
            status="⚠️  Refactor"
        elif [ $score -ge 35 ]; then
            status="📋 Plan"
        elif [ $score -ge 20 ]; then
            status="👀 Monitor"
        else
            status="✅ Good"
        fi
        
        printf "%-30s %-8s %-10s %-8s %-12s %s\n" "$file" "$loc" "$branches" "$score" "$rating" "$status"
    done
    
    echo ""
    echo "========================================"
    echo "Legend:"
    echo "  🟢 1-2/10  = Simple, well-maintained"
    echo "  🟡 3-4/10  = Moderate complexity"
    echo "  🟠 5-8/10  = High complexity, consider refactoring"
    echo "  🔴 9-10/10 = Very complex, needs immediate attention"
    echo ""
    echo "Run with VERBOSE=1 for detailed file analysis"
    echo "========================================"
}

# Check if we're running detailed analysis on a single file
if [ "$1" = "--file" ] && [ -n "$2" ]; then
    analyze_file "$2"
else
    # Run main analysis
    main "$@"
fi