/**
 * Panel Service
 * App Panel v2 kanonik şemasına mapping ve iş kuralları.
 */

const PanelRepository = require('../repositories/PanelRepository');
const UserRepository = require('../repositories/UserRepository');
const TokenRepository = require('../repositories/TokenRepository');
const ConsultantRepository = require('../repositories/ConsultantRepository');
const ConsultantService = require('./consultantService');

class PanelService {
  static parseCredentialData(row) {
    if (!row.credential_data) return {};
    if (typeof row.credential_data === 'string') {
      try {
        return JSON.parse(row.credential_data);
      } catch {
        return {};
      }
    }
    return row.credential_data;
  }

  static mapUserRowToPanelUser(row) {
    const credentialData = this.parseCredentialData(row);
    const user = UserRepository.mapRowToUser(row);
    const email =
      credentialData.email ||
      credentialData.mail ||
      null;
    const displayName =
      user.username ||
      credentialData.name ||
      credentialData.displayName ||
      null;

    return {
      id: String(user.id),
      email,
      displayName,
      phone: null,
      status: 'active',
      createdAt: user.accountCreatedDate || null,
      lastLoginAt: row.last_login_at
        ? new Date(row.last_login_at).toISOString()
        : null,
      extras: {
        credential: user.credential,
        providerId: credentialData.id || null,
        age: user.age,
        gender: user.gender,
        nativeLang: user.nativeLang,
        profilePhotoUrl: user.profilePhotoUrl,
        isPremium: Boolean(Number(row.is_premium)),
        hasPsychologicalProfile: Boolean(user.lastPsychologicalProfile),
      },
    };
  }

  static mapAgentRowToPanelAgent(row, options = {}) {
    const consultant = ConsultantRepository.mapRowToConsultant(row);
    const names = consultant.names || {};
    const displayName =
      names.tr ||
      names.en ||
      Object.values(names).find((v) => typeof v === 'string' && v.trim()) ||
      `Agent #${consultant.id}`;

    const agent = {
      id: String(consultant.id),
      displayName,
      names: consultant.names,
      job: consultant.job,
      status: 'active',
      createdAt: consultant.createdDate
        ? new Date(consultant.createdDate).toISOString()
        : row.created_at
          ? new Date(row.created_at).toISOString()
          : null,
      owner: {
        type: 'platform',
        id: 'mindcoach',
        displayName: 'MindCoach Platform',
      },
      usage: {
        linkedUserCount: Number(row.linked_user_count || 0),
        chatCount: Number(row.chat_count || 0),
      },
      extras: {
        mainPrompt: consultant.mainPrompt,
        photoURL: consultant.photoURL,
        voiceId: consultant.voiceId,
        url3d: consultant.url3d,
        explanation: consultant.explanation,
        features: consultant.features,
        roles: consultant.roles,
        rating: consultant.rating,
      },
    };

    if (options.includeLinkedUsers && options.linkedUsers) {
      agent.linkedUsers = options.linkedUsers;
    }

    return agent;
  }

  static async getHealth() {
    return { ok: true, service: 'mindcoach-api', contractVersion: '2' };
  }

  static async getAnalyse() {
    const [totalUsers, loginsToday, newUsersToday, daily] = await Promise.all([
      PanelRepository.countTotalUsers(),
      PanelRepository.countLoginsToday(),
      PanelRepository.countNewUsersToday(),
      PanelRepository.getDailyMetrics(),
    ]);

    return {
      contractVersion: '2',
      generatedAt: new Date().toISOString(),
      timezone: PanelRepository.getTimezone(),
      summary: {
        totalUsers,
        loginsToday,
        newUsersToday,
      },
      daily,
    };
  }

  static async listUsers(page, limit) {
    const { rows, total, page: p, limit: l } =
      await PanelRepository.findUsersPaginated(page, limit);

    return {
      contractVersion: '2',
      data: rows.map((row) => this.mapUserRowToPanelUser(row)),
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l) || 0,
      },
    };
  }

  static async getUserById(id) {
    const row = await PanelRepository.findUserById(id);
    if (!row) return null;
    return this.mapUserRowToPanelUser(row);
  }

  /**
   * Panel PATCH → MindCoach user alanları.
   * extras: shallow merge (mevcut extras üzerine yazar, nested merge yok).
   */
  static async updateUserFromPanel(id, body = {}) {
    const existing = await UserRepository.findById(id);
    if (!existing) return null;

    const updateData = {};
    const user = UserRepository.mapRowToUser(existing);

    if (body.displayName !== undefined) {
      updateData.username = body.displayName;
    }

    if (body.email !== undefined) {
      const credentialData = { ...(user.credentialData || {}) };
      credentialData.email = body.email;
      updateData.credentialData = credentialData;
    }

    if (body.status === 'banned' || body.status === 'inactive') {
      await TokenRepository.revokeAll(id);
    }

    if (body.extras && typeof body.extras === 'object') {
      if (body.extras.age !== undefined) updateData.age = body.extras.age;
      if (body.extras.gender !== undefined) updateData.gender = body.extras.gender;
      if (body.extras.nativeLang !== undefined) {
        updateData.nativeLang = body.extras.nativeLang;
      }
      if (body.extras.profilePhotoUrl !== undefined) {
        updateData.profilePhotoUrl = body.extras.profilePhotoUrl;
      }
    }

    if (Object.keys(updateData).length === 0) {
      const row = await PanelRepository.findUserById(id);
      return this.mapUserRowToPanelUser(row);
    }

    await UserRepository.update(id, updateData);
    const row = await PanelRepository.findUserById(id);
    return this.mapUserRowToPanelUser(row);
  }

  static async listAgents(page, limit) {
    const { rows, total, page: p, limit: l } =
      await PanelRepository.findAgentsPaginated(page, limit);

    return {
      contractVersion: '2',
      data: rows.map((row) => this.mapAgentRowToPanelAgent(row)),
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l) || 0,
      },
    };
  }

  static async getAgentById(id, includeLinkedUsers = true) {
    const row = await PanelRepository.findAgentById(id);
    if (!row) return null;

    let linkedUsers;
    if (includeLinkedUsers) {
      const users = await PanelRepository.findAgentLinkedUsers(id);
      linkedUsers = users.map((u) => {
        const cred = this.parseCredentialData(u);
        return {
          userId: String(u.id),
          displayName: u.username || cred.name || null,
          email: cred.email || null,
          credential: u.credential,
          firstChatAt: u.first_chat_date
            ? new Date(u.first_chat_date).toISOString()
            : null,
          lastMessageAt: u.last_message_date
            ? new Date(u.last_message_date).toISOString()
            : null,
        };
      });
    }

    return this.mapAgentRowToPanelAgent(row, {
      includeLinkedUsers,
      linkedUsers,
    });
  }

  static async createAgent(payload) {
    const consultant = await ConsultantService.createConsultant(payload);
    const row = await PanelRepository.findAgentById(consultant.id);
    return this.mapAgentRowToPanelAgent(row);
  }

  static async updateAgentFromPanel(id, body = {}) {
    const existing = await ConsultantRepository.findById(parseInt(id, 10));
    if (!existing) return null;

    const patch = {};
    if (body.displayName !== undefined || body.names !== undefined) {
      const names = { ...(existing.names || {}) };
      if (body.names && typeof body.names === 'object') {
        Object.assign(names, body.names);
      }
      if (body.displayName) {
        names.tr = body.displayName;
      }
      patch.names = names;
    }
    if (body.job !== undefined) patch.job = body.job;
    if (body.extras?.mainPrompt !== undefined) {
      patch.mainPrompt = body.extras.mainPrompt;
    } else if (body.mainPrompt !== undefined) {
      patch.mainPrompt = body.mainPrompt;
    }
    if (body.extras?.photoURL !== undefined) patch.photoURL = body.extras.photoURL;
    if (body.extras?.voiceId !== undefined) patch.voiceId = body.extras.voiceId;
    if (body.extras?.url3d !== undefined) patch.url3d = body.extras.url3d;
    if (body.extras?.explanation !== undefined) {
      patch.explanation = body.extras.explanation;
    }
    if (body.extras?.features !== undefined) patch.features = body.extras.features;
    if (body.extras?.roles !== undefined) patch.roles = body.extras.roles;
    if (body.extras?.rating !== undefined) patch.rating = body.extras.rating;

    if (Object.keys(patch).length === 0) {
      return this.getAgentById(id, false);
    }

    await ConsultantRepository.update(parseInt(id, 10), patch);
    return this.getAgentById(id, false);
  }

  static getAgentCatalog() {
    return ConsultantService.getCatalog();
  }
}

module.exports = PanelService;
