/**
 * Consultant Service
 * Business logic for consultant operations
 */

const ConsultantRepository = require('../repositories/ConsultantRepository');

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

