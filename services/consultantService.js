/**
 * Consultant Service
 * Business logic for consultant operations
 */

const ConsultantRepository = require('../repositories/ConsultantRepository');
const {
  isValidJob,
  isValidFeature,
  isValidRole,
  isValidExplanation,
  getCatalog,
  JOBS,
} = require('../config/consultantCatalog');

class ConsultantService {
  /**
   * Get all consultants
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of consultants
   */
  static async getAllConsultants(options = {}) {
    try {
      return await ConsultantRepository.findAll(options);
    } catch (error) {
      console.error('Error getting all consultants:', error);
      throw error;
    }
  }

  /**
   * Get consultant by ID
   * @param {number} id - Consultant ID
   * @returns {Promise<Consultant|null>} Consultant or null
   */
  static async getConsultantById(id) {
    try {
      if (!id || isNaN(id)) {
        throw new Error('Invalid consultant ID');
      }

      const consultant = await ConsultantRepository.findById(parseInt(id));
      
      if (!consultant) {
        return null;
      }

      return consultant;
    } catch (error) {
      console.error('Error getting consultant by ID:', error);
      throw error;
    }
  }

  /**
   * Get consultants by job
   * @param {string} job - Job title
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of consultants
   */
  static async getConsultantsByJob(job, options = {}) {
    try {
      if (!job || typeof job !== 'string') {
        throw new Error('Invalid job parameter');
      }

      return await ConsultantRepository.findByJob(job, options);
    } catch (error) {
      console.error('Error getting consultants by job:', error);
      throw error;
    }
  }

  /**
   * Create a new consultant (admin)
   *
   * Validation rules (catalog-driven):
   *   • names: en az bir dilde isim
   *   • job: catalog'daki JOBS listesinde olmalı
   *   • mainPrompt: zorunlu
   *   • features: catalog'daki o job'a ait FEATURES_BY_JOB içinde olmalı
   *   • roles:    catalog'daki ROLES içinde olmalı
   *   • explanation: catalog'daki o job'a ait EXPLANATIONS_BY_JOB içinde olmalı (key)
   *   • rating: 0..5
   *
   * @param {Object} payload - Consultant fields
   * @returns {Promise<Consultant>} Newly created consultant
   * @throws {Error} ValidationError-like with `.statusCode = 400` when payload is invalid
   */
  static async createConsultant(payload = {}) {
    try {
      const errors = [];

      // ── names ────────────────────────────────────────────────────────────
      const names = payload.names || {};
      if (
        !names ||
        typeof names !== 'object' ||
        Array.isArray(names) ||
        Object.keys(names).length === 0
      ) {
        errors.push('names: must be a non-empty object (e.g. {"tr":"Ali","en":"Ali"})');
      } else {
        for (const [k, v] of Object.entries(names)) {
          if (typeof v !== 'string' || v.trim() === '') {
            errors.push(`names.${k}: must be a non-empty string`);
            break;
          }
        }
      }

      // ── job: catalog'da olmalı ──────────────────────────────────────────
      const job = (payload.job || '').toString().trim();
      if (!job) {
        errors.push('job: required (rehberlik alanı)');
      } else if (!isValidJob(job)) {
        errors.push(
          `job: '${job}' geçerli bir rehberlik alanı değil. ` +
            `Available: [${JOBS.join(', ')}]`
        );
      }

      // ── mainPrompt ──────────────────────────────────────────────────────
      const mainPrompt = (payload.mainPrompt || payload.main_prompt || '')
        .toString()
        .trim();
      if (!mainPrompt) {
        errors.push('mainPrompt: required');
      }

      // ── features: array ve her biri o job için catalog'da olmalı ───────
      const features = payload.features ?? [];
      if (!Array.isArray(features)) {
        errors.push('features: must be an array');
      } else if (isValidJob(job)) {
        for (const f of features) {
          if (typeof f !== 'string' || !isValidFeature(job, f)) {
            errors.push(
              `features: '${f}' '${job}' job'u için geçerli değil. ` +
                `Allowed: [${require('../config/consultantCatalog')
                  .FEATURES_BY_JOB[job].join(', ')}]`
            );
            break;
          }
        }
      }

      // ── roles: array ve her biri ROLES içinde olmalı ────────────────────
      const roles = payload.roles ?? [];
      if (!Array.isArray(roles)) {
        errors.push('roles: must be an array');
      } else {
        for (const r of roles) {
          if (typeof r !== 'string' || !isValidRole(r)) {
            errors.push(
              `roles: '${r}' geçerli değil. Allowed: [${require('../config/consultantCatalog')
                .ROLES.join(', ')}]`
            );
            break;
          }
        }
      }

      // ── explanation: catalog'da o job için bir key olmalı (opsiyonel) ──
      const explanation = payload.explanation ?? null;
      if (explanation !== null && explanation !== '') {
        if (typeof explanation !== 'string' || !isValidExplanation(job, explanation)) {
          errors.push(
            `explanation: '${explanation}' '${job}' job'u için geçerli bir açıklama key'i değil. ` +
              (isValidJob(job)
                ? `Allowed: [${require('../config/consultantCatalog')
                    .EXPLANATIONS_BY_JOB[job].join(', ')}]`
                : 'Önce geçerli bir job belirtin.')
          );
        }
      }

      // ── rating ──────────────────────────────────────────────────────────
      const ratingRaw = payload.rating;
      let rating = 0;
      if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== '') {
        rating = Number(ratingRaw);
        if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
          errors.push('rating: must be a number between 0 and 5');
        }
      }

      // ── opsiyonel string'ler ────────────────────────────────────────────
      const photoURL = payload.photoURL || payload.photo_url || null;
      const url3d = payload.url3d || payload['3d_url'] || null;
      const voiceId = payload.voiceId || payload.voice_id || null;

      if (errors.length > 0) {
        const err = new Error(`Validation failed: ${errors.join('; ')}`);
        err.statusCode = 400;
        err.validationErrors = errors;
        throw err;
      }

      return await ConsultantRepository.create({
        names,
        mainPrompt,
        photoURL,
        voiceId,
        url3d,
        explanation,
        features,
        job,
        roles,
        rating,
      });
    } catch (error) {
      if (!error.statusCode) {
        console.error('Error creating consultant:', error);
      }
      throw error;
    }
  }

  /**
   * Returns the full consultant catalog used by the admin UI.
   * Admin panel populates dropdowns from this single source of truth.
   * @returns {Object} { jobs, featuresByJob, roles, explanationsByJob }
   */
  static getCatalog() {
    return getCatalog();
  }

  /**
   * Get distinct list of rehberlik alanları that have at least one consultant
   * in the database. (Catalog-defined jobs may be more — see getCatalog().)
   * @returns {Promise<Array<string>>}
   */
  static async getAllJobs() {
    try {
      return await ConsultantRepository.getAllJobs();
    } catch (error) {
      console.error('Error getting all jobs:', error);
      throw error;
    }
  }

  /**
   * Get consultants by created date
   * @param {string} createdDate - Created date (ISO 8601 format)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of consultants
   */
  static async getConsultantsByCreatedDate(createdDate, options = {}) {
    try {
      if (!createdDate || typeof createdDate !== 'string') {
        throw new Error('Invalid created date parameter');
      }

      return await ConsultantRepository.findByCreatedDate(createdDate, options);
    } catch (error) {
      console.error('Error getting consultants by created date:', error);
      throw error;
    }
  }
}

module.exports = ConsultantService;

