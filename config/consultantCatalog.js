/**
 * Consultant Catalog — Tek doğruluk kaynağı
 *
 * Admin panelinden yeni rehber eklerken seçilebilecek tüm geçerli değerler:
 *   • JOBS:               rehberlik alanları (snake_case key, Flutter JobConvert ile localize)
 *   • FEATURES_BY_JOB:    her job için seçilebilecek feature key'leri
 *   • ROLES:              consultant rolleri (male/female, gender-based avatar)
 *   • EXPLANATIONS_BY_JOB: her job için 12 hazır açıklama key'i (Flutter l10n key formatı)
 *
 * Yeni job/feature/role/explanation eklemek için:
 *   1. Buradaki listeye ekle
 *   2. Flutter `JobConvert` / `FeatureConvert` / `RoleConvert` / `ExplanationConvert`
 *      dosyasına case ekle
 *   3. ARB dosyalarına yeni l10n key ekle
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Rehberlik alanları (jobs)
// JobConvert.dart ile birebir uyumlu olmalı.
// ─────────────────────────────────────────────────────────────────────────────
const JOBS = Object.freeze([
  'family_assistant',
  'thought_and_habit_guide',
  'adult',
  'child',
  'teenage',
  'personal',
  'exam_anxiety',
  'emotional_balance',
  'difficult_experiences',
  'resilience_empowerment',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Her job için seçilebilecek feature key'leri
// FeatureConvert.dart ile birebir uyumlu olmalı.
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES_BY_JOB = Object.freeze({
  family_assistant: [
    'family_conflicts',
    'parenting',
    'communication',
    'boundaries',
    'relationship_repair',
    'divorce_support',
    'child_behavior',
    'family_harmony',
  ],
  thought_and_habit_guide: [
    'stress_management',
    'self_confidence',
    'life_balance',
    'emotional_regulation',
    'decision_making',
    'motivation',
    'personal_growth',
    'overthinking',
  ],
  adult: [
    'stress_management',
    'self_confidence',
    'life_balance',
    'career_guidance',
    'emotional_regulation',
    'decision_making',
    'motivation',
    'personal_growth',
  ],
  child: [
    'emotional_awareness',
    'social_skills',
    'school_adaptation',
    'self_expression',
    'fear_management',
    'friendship_building',
    'focus_attention',
    'behavioral_support',
  ],
  teenage: [
    'identity_development',
    'peer_pressure',
    'academic_stress',
    'self_esteem',
    'digital_wellbeing',
    'anger_management',
    'future_planning',
    'parent_communication',
  ],
  personal: [
    'loneliness',
    'anxiety_support',
    'grief_processing',
    'mindfulness',
    'sleep_improvement',
    'overthinking',
    'self_discovery',
    'emotional_healing',
  ],
  exam_anxiety: [
    'test_anxiety',
    'study_techniques',
    'time_management',
    'performance_pressure',
    'concentration',
    'relaxation_methods',
    'exam_preparation',
    'confidence_building',
  ],
  emotional_balance: [
    'emotional_regulation',
    'mindfulness',
    'self_discovery',
    'emotional_healing',
    'anxiety_support',
    'stress_management',
    'overthinking',
    'self_confidence',
  ],
  difficult_experiences: [
    'grief_processing',
    'emotional_healing',
    'anxiety_support',
    'loneliness',
    'self_confidence',
    'emotional_regulation',
    'mindfulness',
    'self_discovery',
  ],
  resilience_empowerment: [
    'self_confidence',
    'motivation',
    'personal_growth',
    'self_discovery',
    'decision_making',
    'mindfulness',
    'self_esteem',
    'confidence_building',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Roller (avatar gender + ileride başka roller eklenebilir)
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = Object.freeze(['male', 'female']);

// ─────────────────────────────────────────────────────────────────────────────
// Her job için 12 hazır açıklama key'i (snake_case format).
// DB'de `consultants.explanation` alanına bu key kaydedilir
// (ör: "explanation_family_assistant_3").
// Flutter `ExplanationConvert.dart` bu key'i camelCase l10n key'ine
// (ör: l10n.explanationFamilyAssistant3) çevirir.
// ARB dosyalarında her key için lokalize string olmalıdır.
// ─────────────────────────────────────────────────────────────────────────────
const _generateExplanationKeys = (jobSnake, count = 12) =>
  Array.from(
    { length: count },
    (_, i) => `explanation_${jobSnake}_${i + 1}`
  );

const EXPLANATIONS_BY_JOB = Object.freeze({
  family_assistant: _generateExplanationKeys('family_assistant'),
  thought_and_habit_guide: _generateExplanationKeys('thought_and_habit_guide'),
  adult: _generateExplanationKeys('adult'),
  child: _generateExplanationKeys('child'),
  teenage: _generateExplanationKeys('teenage'),
  personal: _generateExplanationKeys('personal'),
  exam_anxiety: _generateExplanationKeys('exam_anxiety'),
  emotional_balance: _generateExplanationKeys('emotional_balance'),
  difficult_experiences: _generateExplanationKeys('difficult_experiences'),
  resilience_empowerment: _generateExplanationKeys('resilience_empowerment'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────
const isValidJob = (job) => JOBS.includes(job);

const isValidFeature = (job, feature) =>
  isValidJob(job) && FEATURES_BY_JOB[job].includes(feature);

const isValidRole = (role) => ROLES.includes(role);

const isValidExplanation = (job, explanationKey) =>
  isValidJob(job) && EXPLANATIONS_BY_JOB[job].includes(explanationKey);

const getCatalog = () => ({
  jobs: [...JOBS],
  featuresByJob: Object.fromEntries(
    Object.entries(FEATURES_BY_JOB).map(([k, v]) => [k, [...v]])
  ),
  roles: [...ROLES],
  explanationsByJob: Object.fromEntries(
    Object.entries(EXPLANATIONS_BY_JOB).map(([k, v]) => [k, [...v]])
  ),
});

module.exports = {
  JOBS,
  FEATURES_BY_JOB,
  ROLES,
  EXPLANATIONS_BY_JOB,
  isValidJob,
  isValidFeature,
  isValidRole,
  isValidExplanation,
  getCatalog,
};
