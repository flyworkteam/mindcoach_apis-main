/**
 * Consultant Repository
 * Database operations for consultants
 */

const pool = require('../config/database');
const Consultant = require('../models/Consultant');

class ConsultantRepository {
  static _parseRoles(rawRoles) {
    if (!rawRoles) return [];
    if (Array.isArray(rawRoles)) return rawRoles;
    if (typeof rawRoles === 'string') {
      const trimmed = rawRoles.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
      return [trimmed];
    }
    return [];
  }

  /**
   * Map database row to Consultant model
   * @param {Object} row - Database row
   * @returns {Consultant} Consultant instance
   */
  static mapRowToConsultant(row) {
    return new Consultant({
      id: row.id,
      names: typeof row.names === 'string' ? JSON.parse(row.names) : row.names,
      mainPrompt: row.main_prompt,
      photoURL: row.photo_url,
      voiceId: row.voice_id || null,
      '3d_url': row['3d_url'] || null,
      createdDate: row.created_date,
      explanation: row.explanation,
      features: typeof row.features === 'string' ? JSON.parse(row.features) : (row.features || []),
      job: row.job,
      roles: this._parseRoles(row.roles),
      rating: Number(row.rating || 0),
    });
  }

  /**
   * Get all consultants
   * @param {Object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Array of consultants
   */
  static async findAll(options = {}) {
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const orderBy = options.orderBy || 'created_at DESC';

      const [rows] = await pool.execute(
        `SELECT * FROM consultants 
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      return rows.map(row => this.mapRowToConsultant(row));
    } catch (error) {
      console.error('Error finding all consultants:', error);
      throw error;
    }
  }

  /**
   * Find consultant by ID
   * @param {number} id - Consultant ID
   * @returns {Promise<Consultant|null>} Consultant or null
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM consultants WHERE id = ? LIMIT 1',
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToConsultant(rows[0]);
    } catch (error) {
      console.error('Error finding consultant by ID:', error);
      throw error;
    }
  }

  /**
   * Find consultants by job
   * @param {string} job - Job title
   * @param {Object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Array of consultants
   */
  static async findByJob(job, options = {}) {
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const orderBy = options.orderBy || 'created_at DESC';

      const [rows] = await pool.execute(
        `SELECT * FROM consultants 
         WHERE job = ?
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [job, limit, offset]
      );

      return rows.map(row => this.mapRowToConsultant(row));
    } catch (error) {
      console.error('Error finding consultants by job:', error);
      throw error;
    }
  }

  /**
   * Find consultants by created date
   * @param {string} createdDate - Created date (ISO 8601 format)
   * @param {Object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Array of consultants
   */
  static async findByCreatedDate(createdDate, options = {}) {
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const orderBy = options.orderBy || 'created_at DESC';

      const [rows] = await pool.execute(
        `SELECT * FROM consultants 
         WHERE created_date = ?
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [createdDate, limit, offset]
      );

      return rows.map(row => this.mapRowToConsultant(row));
    } catch (error) {
      console.error('Error finding consultants by created date:', error);
      throw error;
    }
  }

  /**
   * Create a new consultant
   * @param {Object} data - Consultant data
   * @returns {Promise<Consultant>} Newly created consultant
   */
  static async create(data) {
    try {
      const {
        names = {},
        mainPrompt = '',
        photoURL = null,
        voiceId = null,
        url3d = null,
        explanation = null,
        features = [],
        job = '',
        roles = [],
        rating = 0,
      } = data;

      // created_date: ISO date (YYYY-MM-DD); created_at: timestamp default
      const createdDate =
        data.createdDate || new Date().toISOString().slice(0, 10);

      const namesJson = JSON.stringify(names);
      const featuresJson = JSON.stringify(features);
      const rolesJson = JSON.stringify(roles);

      const [result] = await pool.execute(
        `INSERT INTO consultants
          (names, main_prompt, photo_url, voice_id, \`3d_url\`,
           created_date, explanation, features, job, roles, rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          namesJson,
          mainPrompt,
          photoURL,
          voiceId,
          url3d,
          createdDate,
          explanation,
          featuresJson,
          job,
          rolesJson,
          rating,
        ]
      );

      const insertedId = result.insertId;
      return await this.findById(insertedId);
    } catch (error) {
      console.error('Error creating consultant:', error);
      throw error;
    }
  }

  /**
   * Get distinct list of existing rehberlik alanları (job values).
   * Empty/null jobs are filtered out.
   * @returns {Promise<Array<string>>}
   */
  static async getAllJobs() {
    try {
      const [rows] = await pool.execute(
        `SELECT DISTINCT job FROM consultants
         WHERE job IS NOT NULL AND TRIM(job) <> ''
         ORDER BY job ASC`
      );
      return rows.map((r) => r.job);
    } catch (error) {
      console.error('Error getting all jobs:', error);
      throw error;
    }
  }

  /**
   * Find consultants by date range
   * @param {string} startDate - Start date (ISO 8601 format)
   * @param {string} endDate - End date (ISO 8601 format)
   * @param {Object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Array of consultants
   */
  static async findByDateRange(startDate, endDate, options = {}) {
    try {
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const orderBy = options.orderBy || 'created_at DESC';

      const [rows] = await pool.execute(
        `SELECT * FROM consultants 
         WHERE created_date >= ? AND created_date <= ?
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [startDate, endDate, limit, offset]
      );

      return rows.map(row => this.mapRowToConsultant(row));
    } catch (error) {
      console.error('Error finding consultants by date range:', error);
      throw error;
    }
  }
}

module.exports = ConsultantRepository;

