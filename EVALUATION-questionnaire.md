# Evaluation Questionnaire: Centrality-Weighted Paths

**Feature**: Logarithmic centrality penalty in Steiner tree path finding
**Branch**: `feature/centrality-weighted-paths`
**Evaluation Period**: 2-3 weeks (starting 2025-11-05)

## Purpose
This questionnaire helps assess whether centrality-weighted path traversal improves knowledge graph search quality. Answer periodically (weekly recommended) during the evaluation period.

---

## Weekly Assessment (Answer 1-5 scale + notes)

### Week: _________ | Date: _________

### 1. Search Result Diversity
**Question**: Are search results showing a healthy variety of entities, or do you see the same few nodes repeatedly?

- 1 = Same hub nodes dominate every search
- 3 = Moderate variety, some repetition
- 5 = Excellent diversity, fresh entities surfacing regularly

**Rating**: [ ] / 5

**Notes**:
```


```

---

### 2. Peripheral Entity Discovery
**Question**: When searching for specific/niche topics, do relevant specialized entities surface, or are they overshadowed by general hub nodes?

- 1 = Specific entities rarely appear, hubs dominate
- 3 = Sometimes surfaces, inconsistent
- 5 = Niche entities consistently found when relevant

**Rating**: [ ] / 5

**Notes**:
```


```

---

### 3. Connection Quality
**Question**: Do the connecting paths between query results feel meaningful and contextually relevant?

- 1 = Paths feel forced/unnatural through unrelated hubs
- 3 = Mostly relevant, occasional odd connections
- 5 = Paths illuminate genuine conceptual relationships

**Rating**: [ ] / 5

**Notes**:
```


```

---

### 4. Hub Accessibility
**Question**: When you NEED high-centrality nodes (core concepts), are they still accessible and appearing appropriately?

- 1 = Important hubs missing when needed
- 3 = Usually accessible, occasionally absent
- 5 = Critical hubs still surface when truly relevant

**Rating**: [ ] / 5

**Notes**:
```


```

---

### 5. Overall Search Effectiveness
**Question**: Compared to before this change, does search feel more useful for finding relevant information?

- 1 = Significantly worse than before
- 2 = Slightly worse
- 3 = About the same
- 4 = Slightly better
- 5 = Significantly better

**Rating**: [ ] / 5

**Notes**:
```


```

---

## Comparison Baseline (Pre-Change Snapshot)

If available, note the baseline behavior before enabling weighted paths:

**Date**: _________

**Typical search pattern**:
```
(Describe what search results looked like before the change - which entities appeared most,
what connections were shown, any observed problems)


```

---

## Quantitative Observations (Optional)

If you notice specific patterns, document here:

### High-Frequency Entities (appearing in most searches)
**Pre-change**:
```


```

**Post-change**:
```


```

### Example Search Improvements
Document specific searches that improved or degraded:

**Example 1**:
- Query:
- Before:
- After:
- Assessment:

**Example 2**:
- Query:
- Before:
- After:
- Assessment:

---

## Decision Checkpoint

### After 2-3 Weeks: Merge Decision

**Average ratings across evaluation period**:
- Diversity: ___/5
- Discovery: ___/5
- Connection Quality: ___/5
- Hub Accessibility: ___/5
- Overall Effectiveness: ___/5

**Decision criteria**:
- **Merge to main** if:
  - Overall effectiveness ≥ 4.0
  - All other metrics ≥ 3.0
  - No critical regressions observed

- **Keep testing** if:
  - Mixed results (2.5-3.5 range)
  - Need more data to assess

- **Revert to main** if:
  - Overall effectiveness < 3.0
  - Hub accessibility < 3.0 (critical hubs missing)
  - Clear negative impact on search quality

**Final Decision**: [ ] Merge  [ ] Continue Testing  [ ] Revert

**Rationale**:
```


```

---

## Notes

- Save completed questionnaires with timestamp: `EVAL-YYYY-MM-DD.md`
- Compare across weeks to track trends
- Subjective assessment is valuable - trust your experience
- Document specific examples (they're more useful than just ratings)
