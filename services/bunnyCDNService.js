/**
 * Bunny CDN Service
 * Handles file uploads to Bunny CDN
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class BunnyCDNService {
  /**
   * Upload file to Bunny CDN
   * @param {Buffer|Stream} fileBuffer - File buffer or stream
   * @param {string} fileName - Original file name
   * @param {string} fileType - File type: 'image' or 'voice'
   * @returns {Promise<string>} CDN URL of uploaded file
   */
  static async uploadFile(fileBuffer, fileName, fileType = 'image') {
    try {
      const storageZoneName = process.env.BUNNY_CDN_STORAGE_ZONE || '';
      const storageZonePassword = process.env.BUNNY_CDN_STORAGE_PASSWORD || '';
      const cdnHostname = process.env.BUNNY_CDN_HOSTNAME || '';

      if (!storageZoneName || !storageZonePassword || !cdnHostname) {
        throw new Error('Bunny CDN configuration is missing. Please check environment variables.');
      }

      // Determine folder based on file type
      const folder = fileType === 'voice' ? 'voices' : 'images';
      
      // Generate unique filename
      const timestamp = Date.now();
      const ext = path.extname(fileName);
      const uniqueFileName = `${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
      const cdnPath = `${folder}/${uniqueFileName}`;

      // Upload to Bunny CDN Storage
      const uploadUrl = `https://storage.bunnycdn.com/${storageZoneName}/${cdnPath}`;
      
      const response = await axios.put(uploadUrl, fileBuffer, {
        headers: {
          'AccessKey': storageZonePassword,
          'Content-Type': this.getContentType(fileName, fileType)
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000 // 5 minutes timeout for large files
      });

      if (response.status === 201 || response.status === 200) {
        // Return CDN URL - Use CDN hostname with appropriate folder
        // Format: https://cdn-hostname.com/folder/filename
        const cdnUrl = `https://mindcoach.b-cdn.net/${folder}/${uniqueFileName}`;
        return cdnUrl;
      } else {
        throw new Error(`Failed to upload file to Bunny CDN. Status: ${response.status}`);
      }
    } catch (error) {
      console.error('Bunny CDN upload error:', error);
      throw new Error(`Failed to upload file to Bunny CDN: ${error.message}`);
    }
  }

  /**
   * Get content type based on file name and type
   * @param {string} fileName - File name
   * @param {string} fileType - File type: 'image' or 'voice'
   * @returns {string} Content type
   */
  static getContentType(fileName, fileType) {
    const ext = path.extname(fileName).toLowerCase();
    
    if (fileType === 'voice') {
      const voiceTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac'
      };
      return voiceTypes[ext] || 'audio/mpeg';
    } else {
      const imageTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
      };
      return imageTypes[ext] || 'image/jpeg';
    }
  }

  /**
   * Validate file type
   * @param {string} fileName - File name
   * @param {string} fileType - Expected file type: 'image' or 'voice'
   * @returns {boolean} True if valid
   */
  static validateFileType(fileName, fileType) {
    const ext = path.extname(fileName).toLowerCase();
    
    if (fileType === 'voice') {
      const validExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
      return validExtensions.includes(ext);
    } else {
      const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
      return validExtensions.includes(ext);
    }
  }
}

module.exports = BunnyCDNService;

