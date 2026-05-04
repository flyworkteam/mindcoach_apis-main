class User {
  constructor(data) {
    this.id = data.id;
    this.age = data.age ?? null;
    this.credential = data.credential; // 'google', 'facebook', 'apple'
    this.credentialData = data.credentialData;
    this.username = data.username;
    this.nativeLang = data.nativeLang || null;
    this.gender = data.gender || 'unknown';
    this.answerData = data.answerData || null;
    this.lastPsychologicalProfile = data.lastPsychologicalProfile || null;
    this.userAgentNotes = data.userAgentNotes || null;
    this.leastSessions = data.leastSessions || null;
    this.psychologicalProfileBasedOnMessages = data.psychologicalProfileBasedOnMessages || null;
    this.accountCreatedDate = data.accountCreatedDate || new Date().toISOString();
    this.generalProfile = data.generalProfile || null;
    this.generalPsychologicalProfile = data.generalPsychologicalProfile || null;
    this.profilePhotoUrl = data.profilePhotoUrl || null;
  }

  toJSON() {
    return {
      id: this.id,
      age: this.age,
      credential: this.credential,
      credentialData: this.credentialData,
      username: this.username,
      nativeLang: this.nativeLang,
      gender: this.gender,
      answerData: this.answerData,
      lastPsychologicalProfile: this.lastPsychologicalProfile,
      userAgentNotes: this.userAgentNotes,
      leastSessions: this.leastSessions,
      psychologicalProfileBasedOnMessages: this.psychologicalProfileBasedOnMessages,
      accountCreatedDate: this.accountCreatedDate,
      generalProfile: this.generalProfile,
      generalPsychologicalProfile: this.generalPsychologicalProfile,
      profilePhotoUrl: this.profilePhotoUrl,
    };
  }
}

module.exports = User;

