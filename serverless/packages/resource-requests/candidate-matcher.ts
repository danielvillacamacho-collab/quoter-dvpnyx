import type { ResourceRequest, Candidate } from './types';

/**
 * Scoring weights for candidate ranking.
 * Total max score = 100.
 */
const WEIGHTS = {
  AREA_MATCH: 30,
  LEVEL_MATCH: 25,
  SKILLS_MATCH: 25,
  AVAILABILITY: 20,
} as const;

const LEVEL_RANK: Record<string, number> = {
  L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, L6: 6,
  L7: 7, L8: 8, L9: 9, L10: 10, L11: 11,
};

/**
 * Computes area match score (0 or full weight).
 * Exact area match = full score; different area = 0.
 */
function scoreArea(candidateAreaId: number, requestAreaId: number): number {
  return candidateAreaId === requestAreaId ? WEIGHTS.AREA_MATCH : 0;
}

/**
 * Computes level match score.
 * Exact match = full weight. Each level gap reduces score by 20% of weight.
 * 5+ levels apart = 0.
 */
function scoreLevel(candidateLevel: string, requestLevel: string): number {
  const cRank = LEVEL_RANK[candidateLevel] ?? 0;
  const rRank = LEVEL_RANK[requestLevel] ?? 0;
  const gap = Math.abs(cRank - rRank);
  if (gap >= 5) return 0;
  return Math.round(WEIGHTS.LEVEL_MATCH * (1 - gap * 0.2));
}

/**
 * Computes skills match score.
 * Score = (matched required skills / total required skills) * weight.
 * Nice-to-have skills add a small bonus (10% of weight per match, capped at 50% of remaining).
 */
function scoreSkills(
  employeeSkills: number[],
  requiredSkills: number[] | null,
  niceToHaveSkills: number[] | null,
): { score: number; matchingSkills: number[] } {
  const matchingSkills: number[] = [];

  if (!requiredSkills || requiredSkills.length === 0) {
    // No required skills: give full weight
    return { score: WEIGHTS.SKILLS_MATCH, matchingSkills };
  }

  const empSet = new Set(employeeSkills);

  let requiredMatched = 0;
  for (const skillId of requiredSkills) {
    if (empSet.has(skillId)) {
      requiredMatched++;
      matchingSkills.push(skillId);
    }
  }

  const requiredRatio = requiredMatched / requiredSkills.length;
  let baseScore = Math.round(WEIGHTS.SKILLS_MATCH * requiredRatio);

  // Nice-to-have bonus
  if (niceToHaveSkills && niceToHaveSkills.length > 0) {
    const remaining = WEIGHTS.SKILLS_MATCH - baseScore;
    const cap = Math.round(remaining * 0.5);
    let bonus = 0;
    for (const skillId of niceToHaveSkills) {
      if (empSet.has(skillId)) {
        bonus += Math.round(WEIGHTS.SKILLS_MATCH * 0.1);
        matchingSkills.push(skillId);
      }
    }
    baseScore += Math.min(bonus, cap);
  }

  return { score: Math.min(baseScore, WEIGHTS.SKILLS_MATCH), matchingSkills };
}

/**
 * Computes availability score.
 * Full weight if available_hours >= request weekly_hours.
 * Proportional if partially available.
 * 0 if no availability at all.
 */
function scoreAvailability(availableHours: number, requestedHours: number): number {
  if (availableHours <= 0) return 0;
  if (availableHours >= requestedHours) return WEIGHTS.AVAILABILITY;
  return Math.round(WEIGHTS.AVAILABILITY * (availableHours / requestedHours));
}

/**
 * Ranks and scores candidate employees for a resource request.
 * Pure function - no DB access.
 */
export function rankCandidates(
  request: ResourceRequest,
  rawCandidates: Array<{
    employee_id: string;
    first_name: string;
    last_name: string;
    area_id: number;
    area_name: string;
    level: string;
    country: string;
    weekly_capacity_hours: number;
    current_allocated_hours: number;
    available_hours: number;
    status: string;
    employee_skills: number[];
  }>,
): Candidate[] {
  const scored: Candidate[] = rawCandidates.map((c) => {
    const area_match = scoreArea(c.area_id, request.area_id);
    const level_match = scoreLevel(c.level, request.level);
    const { score: skills_match, matchingSkills } = scoreSkills(
      c.employee_skills || [],
      request.required_skills,
      request.nice_to_have_skills,
    );
    const availability = scoreAvailability(
      Number(c.available_hours),
      Number(request.weekly_hours),
    );

    const score = area_match + level_match + skills_match + availability;

    return {
      employee_id: c.employee_id,
      first_name: c.first_name,
      last_name: c.last_name,
      area_id: c.area_id,
      area_name: c.area_name,
      level: c.level,
      country: c.country,
      weekly_capacity_hours: Number(c.weekly_capacity_hours),
      current_allocated_hours: Number(c.current_allocated_hours),
      available_hours: Number(c.available_hours),
      score,
      score_breakdown: { area_match, level_match, skills_match, availability },
      matching_skills: matchingSkills,
      status: c.status,
    };
  });

  // Sort by score descending, then by available_hours descending
  scored.sort((a, b) => b.score - a.score || b.available_hours - a.available_hours);

  return scored;
}
