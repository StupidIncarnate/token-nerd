#!/bin/bash
# Read JSON from stdin and show relevant fields
json=$(cat)
model=$(echo "$json" | jq -r '.model.display_name // .model.id')
cwd=$(echo "$json" | jq -r '.cwd')
transcript_path=$(echo "$json" | jq -r '.transcript_path // empty')
session_id=$(echo "$json" | jq -r '.session_id // empty')

# Debug: uncomment to see what data is available
# echo "DEBUG: transcript_path=$transcript_path" >&2
# echo "DEBUG: session_id=$session_id" >&2


# Check if tamagotchi is available and get its status
tamagotchi_status=""
if command -v claude-code-tamagotchi &> /dev/null; then
    # Call tamagotchi CLI to get current status (adjust command as needed)
    tamagotchi_output=$(claude-code-tamagotchi status 2>/dev/null || echo "")
    if [[ -n "$tamagotchi_output" ]]; then
        tamagotchi_status=" | $tamagotchi_output"
    fi
elif [[ -f "$HOME/.local/bin/tamagotchi" ]]; then
    # Alternative path for tamagotchi
    tamagotchi_output=$("$HOME/.local/bin/tamagotchi" status 2>/dev/null || echo "")
    if [[ -n "$tamagotchi_output" ]]; then
        tamagotchi_status=" | $tamagotchi_output"
    fi
fi

echo "🧠  $model | 📍  $cwd$tamagotchi_status"
