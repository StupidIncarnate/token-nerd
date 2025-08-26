# JSONL Token Fields: What We Can PROVE

**CRITICAL**: Every Claude session gets confused by these fields. This document records ONLY what we can prove with evidence.

## The Problem

Token-nerd TUI was showing "+4,672 actual context growth" but the context window only grew by 236 tokens. This massive discrepancy reveals a fundamental misunderstanding of what these JSONL fields represent.

## The JSONL Usage Fields

```json
{
  "input_tokens": 12,
  "output_tokens": 20, 
  "cache_creation_input_tokens": 942,
  "cache_read_input_tokens": 16187,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 942,
    "ephemeral_1h_input_tokens": 0
  }
}
```

## PROVEN FACTS (with evidence)

### Fact 1: Cache Creation Accumulates Into Cache Read

**Evidence from session 6f519676:**
```
Message A: cache_creation: 4,672 | cache_read: 11,515  
Message B: cache_creation: 942   | cache_read: 16,187
```

**Math**: 11,515 + 4,672 = 16,187 ✓

**Conclusion**: cache_creation tokens from one message become part of cache_read in subsequent messages.

### Fact 2: Cache Creation ≠ Context Window Growth  

**Evidence:**
- Message shows: cache_creation_input_tokens: 4,672
- Context window shows: [015,965] → [016,201] = 236 token growth
- **4,672 ≠ 236**

**Conclusion**: cache_creation_input_tokens does NOT represent active context window growth.

### Fact 3: Context Window Growth is Much Smaller

**Pattern observed:**
- Large cache_creation values (4,672, 942)  
- Small context window jumps (236, etc.)
- Context jumps correlate more with input_tokens + output_tokens

**Data point:**
- input_tokens: 10, output_tokens: 4 = 14 tokens
- Context growth: 236 tokens  
- Ratio: ~17x multiplier (likely includes conversation overhead)

## What We DON'T Know (avoid speculation)

We do NOT have definitive proof of:
- What exactly cache_creation_input_tokens represents internally
- The exact formula for context window growth
- Why the multiplier varies between messages
- What counts as "conversation overhead"

## What Future Claudes Should Do

### ✅ SAFE to assume:
1. `cache_creation_input_tokens` ≠ context window growth
2. Context window growth is much smaller than cache_creation values
3. Cache creation accumulates into cache read over time
4. TUI should NOT display cache_creation as "context growth"

### ❌ UNSAFE to assume:
1. Exact formulas for context window calculation  
2. What cache_creation actually contains
3. Precise overhead multipliers
4. Correlation patterns without more data

## Concrete Fix Needed

**Current broken display:**
```
6:47:34 AM [016,201] | +4,672 actual (4 out) | 🤖 Assistant: message
```

**Should be something like:**
```  
6:47:34 AM [016,201] | +236 context (4 out) | 🤖 Assistant: message
```

**Evidence**: Context window actually grew by 236, not 4,672.

## How to Debug Further

1. Find more examples of context window jumps
2. Compare input_tokens + output_tokens vs actual context growth
3. Look for patterns across different message types
4. Test correlation with ToolResponse file sizes

---

**ONLY UPDATE THIS DOCUMENT WITH NEW EVIDENCE, NOT THEORIES.**