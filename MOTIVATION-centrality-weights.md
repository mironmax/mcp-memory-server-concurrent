# Motivation: Centrality-Weighted Path Traversal

**Branch**: `feature/centrality-weighted-paths`
**Status**: Experimental (2-3 week evaluation period)
**Date**: 2025-11-05

## Problem: Rich-Get-Richer Feedback Loop

### Current Behavior
The Steiner tree algorithm uses **uniform edge weights** (cost = 1 for all edges) when finding shortest paths between query result nodes. This creates a centralization bias:

1. **High-centrality nodes appear in more searches** (they connect many concepts)
2. **More appearances → more user interactions** (new observations, relations added)
3. **More content → higher importance scores** (`log(obsCount) × log(degree)`)
4. **Higher scores → even more likely to be selected** in future searches
5. **Positive feedback loop** → over-concentration in hub nodes

### Evidence from Current Code
```typescript
// index.ts:336 - Importance calculation
const importance = Math.log(e.observations.length + 1) * (1 + Math.log(1 + (degree.get(name) || 0)));

// index.ts:254-289 - Uniform path costs
private findShortestPath(from: string, to: string, graph: KnowledgeGraph, maxLen: number): string[] | null {
  // BFS with unweighted edges (cost = 1)
  // High-centrality nodes are PREFERRED (shorter paths through hubs)
}
```

### Real-World Impact
- **Hub monopolization**: A few popular entities dominate search results
- **Peripheral knowledge buried**: Specific, relevant entities get overlooked
- **Diversity reduction**: Search returns similar subgraphs over time
- **Concept drift**: Knowledge graph clusters around a few topics instead of remaining balanced

## Proposed Solution: Logarithmic Centrality Penalty

### Core Idea
Mirror the TF dampening strategy used in entry selection, but **inverted** for path traversal:

- **Entry selection**: `TF = 1 + log(1 + frequency)` — diminishes returns on high frequency
- **Path traversal**: `cost = 1 + log(1 + centrality)` — diminishes preference for high centrality

### Mathematical Justification
**Logarithmic compression** prevents extreme penalties while still balancing preferences:

| Degree | Linear Cost | Log Cost `1+log(1+d)` | Ratio |
|--------|-------------|----------------------|-------|
| 1      | 1           | 1.30                | 1.0x  |
| 10     | 10          | 3.46                | 0.35x |
| 100    | 100         | 5.62                | 0.06x |

**Effect**: High-centrality nodes become moderately more expensive to traverse, not prohibitively expensive.

### Implementation Strategy
Replace BFS in `findShortestPath()` with **Dijkstra's algorithm**:

```typescript
// Weighted edge cost based on target node centrality
function edgeCost(targetNode: string): number {
  const degree = getDegree(targetNode);
  return 1 + Math.log(1 + degree);
}
```

**Key properties**:
- Entry nodes themselves are not penalized (they're explicitly requested)
- Only **intermediate nodes** in paths accumulate centrality cost
- Paths naturally route around hubs when comparable alternatives exist
- Shortest paths through critical hubs still valid when necessary

## Expected Benefits

1. **Balanced discovery**: Peripheral entities get equal consideration
2. **Diverse results**: Search explores different knowledge neighborhoods
3. **Anti-monopolization**: Prevents few nodes from dominating all results
4. **Graceful degradation**: Log scaling means critical hubs still accessible

## Evaluation Criteria

### Subjective Assessment (User Questionnaire)
- Does search feel more diverse over time?
- Are niche/specific entities surfacing appropriately?
- Do results avoid repetitive hub nodes?
- Is important connecting information still findable?

### Quantitative Metrics (Optional)
- Degree distribution in search results (pre vs post)
- Unique entities per search (diversity metric)
- Path length distribution (ensure not pathological)
- Hub appearance frequency over time

## Risk Mitigation

### Potential Issues
1. **Overly long paths**: Log penalty might force unnatural detours
2. **Lost connectivity**: Critical hubs might be avoided too aggressively
3. **Performance**: Dijkstra slower than BFS (though still fast for small graphs)

### Safeguards
- Existing `SEARCH_MAX_PATH_LENGTH` prevents runaway path length
- Log scaling keeps penalties modest (not exponential)
- Entry nodes always included (query matches unaffected)
- Can tune multiplier if needed: `C + α×log(1+degree)` where `α ∈ [0,1]`

## Evaluation Period

**Duration**: 2-3 weeks of real-world usage
**Decision**: Merge to main only if evaluation confirms benefits outweigh risks

**Rollback plan**: Branch preserved, can revert to uniform weights if problematic
