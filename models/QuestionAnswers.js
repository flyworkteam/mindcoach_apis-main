class QuestionAnswers {
  constructor(data) {
    this.avaibleDays = data.avaibleDays || null;
    this.avaibleHours = data.avaibleHours || null;
    this.supportArea = data.supportArea || '';
    this.agentSpeakStyle = data.agentSpeakStyle || '';
  }

  toJSON() {
    return {
      avaibleDays: this.avaibleDays,
      avaibleHours: this.avaibleHours,
      supportArea: this.supportArea,
      agentSpeakStyle: this.agentSpeakStyle,
    };
  }
}

module.exports = QuestionAnswers;

