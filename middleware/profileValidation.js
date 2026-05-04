/**
 * Profile Completion Validation Middleware
 * Profil tamamlama için request validation
 */

const validateProfileCompletion = (req, res, next) => {
  const { body } = req;
  const errors = [];

  // Username validation - Boşluk ve özel karakterlere izin ver
  // Eğer username boşsa veya sadece boşluklardan oluşuyorsa, default olarak "MindCoach User" kullanılacak
  if (body.username !== undefined) {
    // Username boşsa veya sadece boşluklardan oluşuyorsa, default değer ver (validation hatası verme)
    if (!body.username || typeof body.username !== 'string' || body.username.trim().length === 0) {
      // Username boşsa default değer ver, validation hatası verme
      body.username = 'MindCoach User';
      console.log('📝 Username boş, default değer verildi: "MindCoach User"');
    } else if (body.username.length > 255) {
      errors.push('Username must be less than 255 characters');
    }
    // Boşluk ve özel karakterlere izin ver (örn: "Ahmet Taha Tokmak")
    // Unique kontrolü yok, herkes istediği ismi kullanabilir
  }

  // Gender validation
  if (body.gender !== undefined) {
    if (!['male', 'female', 'unknown'].includes(body.gender)) {
      errors.push('Gender must be one of: male, female, unknown');
    }
  }

  // Native language validation
  if (body.nativeLang !== undefined && body.nativeLang !== null) {
    if (typeof body.nativeLang !== 'string' || body.nativeLang.length > 10) {
      errors.push('Native language must be a string with max 10 characters (e.g., tr, en)');
    }
  }

  // Age validation
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    const parsedAge = Number(body.age);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      errors.push('Age must be an integer between 1 and 120');
    } else {
      body.age = parsedAge;
    }
  }

  // AnswerData validation
  if (body.answerData !== undefined && body.answerData !== null) {
    if (typeof body.answerData !== 'object') {
      errors.push('answerData must be an object');
    } else {
      // QuestionAnswers structure validation
      if (body.answerData.supportArea !== undefined && typeof body.answerData.supportArea !== 'string') {
        errors.push('answerData.supportArea must be a string');
      }
      if (body.answerData.agentSpeakStyle !== undefined && typeof body.answerData.agentSpeakStyle !== 'string') {
        errors.push('answerData.agentSpeakStyle must be a string');
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: errors
    });
  }

  next();
};

module.exports = {
  validateProfileCompletion
};

