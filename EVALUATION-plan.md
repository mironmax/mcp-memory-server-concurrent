# Evaluation Plan: Centrality-Weighted Path Traversal

**Feature Branch**: `feature/centrality-weighted-paths`
**Start Date**: 2025-11-05
**Duration**: 2-3 weeks
**Decision Deadline**: 2025-11-26 (3 weeks) or earlier if clear results

---

## Overview

This feature introduces logarithmic centrality penalties in Steiner tree path finding to address the "rich-get-richer" feedback loop where high-centrality hub nodes dominate search results.

**Core Change**:
```typescript
// Before: uniform edge cost = 1
// After:  weighted edge cost = 1 + log(1 + degree)
```

---

## Evaluation Goals

1. **Validate hypothesis**: Does centrality weighting reduce hub monopolization?
2. **Assess impact**: Does it improve search result diversity without harming quality?
3. **Identify risks**: Are there unexpected negative effects?
4. **Inform decision**: Merge, iterate, or revert?

---

## Methodology

### 1. Deployment
- [x] Create feature branch
- [ ] Build and deploy Docker container from branch
- [ ] Update Claude Code config to use feature branch container
- [ ] Restart Claude Code to activate changes
- [ ] Verify deployment via test search

### 2. Baseline Documentation (Pre-Change)
**Before deploying**, document current behavior:
- Run 5-10 diverse search queries
- Note which entities appear most frequently
- Observe path patterns (do they route through same hubs?)
- Save results in `EVAL-baseline-YYYY-MM-DD.md`

### 3. Weekly Assessment
**Every 7 days** during evaluation:
- Complete questionnaire (EVALUATION-questionnaire.md)
- Save as `EVAL-week-N-YYYY-MM-DD.md`
- Compare to previous week and baseline

### 4. Continuous Observation
Throughout evaluation period, note:
- Surprising or unexpected search results (good or bad)
- Cases where centrality weighting clearly helped/hindered
- Performance issues (Dijkstra slower than BFS?)
- Any edge cases or bugs

---

## Decision Criteria

### Merge to Main
**Conditions**:
- Average "Overall Effectiveness" rating ≥ 4.0
- All weekly ratings ≥ 3.0 (no critical regressions)
- Hub accessibility remains strong (≥ 3.0)
- Clear evidence of improved diversity
- No blocking bugs or performance issues

**Action**:
```bash
git checkout master
git merge feature/centrality-weighted-paths
git push
docker compose build
docker compose up -d
```

### Continue Testing
**Conditions**:
- Mixed results (2.5-3.5 average ratings)
- Unclear impact (need more data)
- Promising but needs tuning

**Action**:
- Extend evaluation 1-2 more weeks
- Consider adjusting weight multiplier
- Gather more specific examples

### Revert to Main
**Conditions**:
- Overall effectiveness < 3.0
- Hub accessibility < 3.0 (critical nodes missing)
- Clear negative impact on search quality
- Blocking bugs or performance issues

**Action**:
```bash
git checkout master
# Branch preserved for future reference
docker compose build
docker compose up -d
```

---

## Rollback Safety

### Branch Preservation
- Feature branch remains after merge/revert
- Can always return to uniform weights
- Commit history preserved

### Quick Revert
If immediate issues arise:
```bash
git checkout master
docker compose build && docker compose up -d
```

### Configuration Tuning
If partial success, can adjust weight formula:
```typescript
// Current
const edgeCost = 1 + Math.log(1 + degree);

// Tunable alternatives
const edgeCost = 1 + α * Math.log(1 + degree);  // α ∈ [0,1]
const edgeCost = 1 + Math.log(1 + degree / β);  // β > 1 for gentler penalty
```

---

## Timeline

| Week | Actions | Deliverables |
|------|---------|--------------|
| 0 (Nov 5) | Deploy feature, document baseline | EVAL-baseline.md |
| 1 (Nov 12) | Weekly assessment, observe patterns | EVAL-week-1.md |
| 2 (Nov 19) | Weekly assessment, compare trends | EVAL-week-2.md |
| 3 (Nov 26) | Final assessment, decision | Merge/revert/continue |

---

## Success Indicators

### Qualitative
- [ ] More varied entities in typical searches
- [ ] Peripheral/specific entities surface appropriately
- [ ] Paths feel contextually meaningful
- [ ] Hub nodes still accessible when needed
- [ ] Overall search experience improved

### Quantitative (Optional)
- [ ] Diversity metric: unique entities per search increases
- [ ] Hub concentration: top 5 entities appear less frequently
- [ ] Path lengths: remain within reasonable bounds
- [ ] Performance: no significant slowdown

---

## Post-Evaluation

### If Merged
- Update README.md with centrality weighting description
- Document in CHANGELOG.md
- Update GitHub with release notes
- Archive evaluation documents for reference

### If Reverted
- Document findings in `EVALUATION-conclusion.md`
- Preserve branch and evaluation data
- Note lessons learned for future improvements

### If Needs Iteration
- Document specific tuning needed
- Create follow-up branch
- Repeat evaluation with adjustments

---

## Contact & Questions

Evaluation owner: Maxim
Questions/concerns: Document in evaluation notes
Unexpected issues: Revert immediately, investigate offline
