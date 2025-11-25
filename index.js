const express = require('express');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));

const sessions = {};

const QUESTIONS = [
  { key: 'patientRef', label: 'Patient Reference' },
  { key: 'A', label: 'A. Smallest supramalleolar circumference (mm)' },
  { key: 'B', label: 'B. Instep circumference (mm)' },
  { key: 'C', label: 'C. Midfoot circumference passing through apex of arch (mm)' },
  { key: 'D', label: 'D. Circumference passing through 1st meta and 5th meta (mm)' },
  { key: 'E', label: 'E. Foot length (mm)' },
  { key: 'F', label: 'F. Length from heel to 1st meta head (mm)' },
  { key: 'G', label: 'G. Length from heel to navicular (mm)' },
  { key: 'H', label: 'H. Length from heel to 5th meta head (mm)' },
  { key: 'I', label: 'I. Length from heel to base of 5th meta (mm)' },
  { key: 'J', label: 'J. Width between metatarsal heads (mm)' },
  { key: 'K', label: 'K. Width between apex of navicular (projected to floor) and base of 5th meta (mm)' },
  { key: 'L', label: 'L. Width of the heel at the widest part (mm)' },
  { key: 'M', label: 'M. Length from heel to apex of medial malleolus (mm)' },
  { key: 'N', label: 'N. Length from ground to apex of medial malleolus (mm)' },
  { key: 'O', label: 'O. Length from heel to apex of lateral malleolus (mm)' },
  { key: 'P', label: 'P. Length from ground to apex of lateral malleolus (mm)' },
  { key: 'Q', label: 'Q. Width at supramalleolar (mm)' },
  { key: 'R', label: 'R. Width at malleoli (mm)' }
];

function getOrCreateSession(from) {
  if (!sessions[from]) {
    sessions[from] = {
      currentIndex: 0,
      answers: {},
      pendingCorrectionKey: null
    };
  }
  return sessions[from];
}

function buildSummary(answers) {
  let lines = [];
  for (const q of QUESTIONS) {
    lines.push(`${q.label}: ${answers[q.key] ?? '-'}`);
  }
  return lines.join('\n');
}

app.post('/whatsapp', (req, res) => {
  const twiml = new MessagingResponse();
  const from = req.body.From || 'unknown';
  const bodyRaw = (req.body.Body || '').trim();
  const body = bodyRaw.toLowerCase();

  let session = getOrCreateSession(from);

  if (body === 'reset') {
    sessions[from] = {
      currentIndex: 0,
      answers: {},
      pendingCorrectionKey: null
    };
    session = sessions[from];
    twiml.message(
      'Session reset ✅\nLet’s start again.\n\n' +
      `${QUESTIONS[0].label}?`
    );
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (body === 'start' && session.currentIndex === 0 && Object.keys(session.answers).length === 0) {
    twiml.message(
      'Okay, we’ll go through the Parametric Foot form together 👣\n\n' +
      'You can type:\n' +
      '- "wrong on N" to correct a value\n' +
      '- "N: 123" to directly set N\n' +
      '- "summary" any time to see what you have so far\n' +
      '- "reset" to start over\n\n' +
      `${QUESTIONS[0].label}?`
    );
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (body === 'summary') {
    twiml.message('Current answers:\n\n' + buildSummary(session.answers));
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (session.pendingCorrectionKey) {
    const key = session.pendingCorrectionKey;
    session.answers[key] = bodyRaw;
    session.pendingCorrectionKey = null;

    const q = QUESTIONS.find(q => q.key === key);
    twiml.message(
      `Updated ${q ? q.label : key} to: ${bodyRaw} ✅\n\n` +
      'Type "summary" to review everything, or continue answering the next question.'
    );

    const nextIndex = QUESTIONS.findIndex(q => !session.answers[q.key]);
    if (nextIndex !== -1) {
      session.currentIndex = nextIndex;
      twiml.message(`${QUESTIONS[nextIndex].label}?`);
    } else {
      twiml.message(
        'All fields completed ✅\n\nHere is your full set:\n\n' +
        buildSummary(session.answers)
      );
    }

    res.type('text/xml').send(twiml.toString());
    return;
  }

  const directSetMatch = bodyRaw.match(/^([A-Ra-r])\s*[:=]\s*(.+)$/);
  if (directSetMatch) {
    const keyLetter = directSetMatch[1].toUpperCase();
    const value = directSetMatch[2].trim();
    const question = QUESTIONS.find(q => q.key === keyLetter);

    if (question) {
      session.answers[keyLetter] = value;
      twiml.message(`Set ${question.label} to: ${value} ✅`);

      const nextIndex = QUESTIONS.findIndex(q => !session.answers[q.key]);
      if (nextIndex !== -1) {
        session.currentIndex = nextIndex;
        twiml.message(`${QUESTIONS[nextIndex].label}?`);
      } else {
        twiml.message(
          'All fields completed ✅\n\nHere is your full set:\n\n' +
          buildSummary(session.answers)
        );
      }

      res.type('text/xml').send(twiml.toString());
      return;
    }
  }

  const wrongOnMatch = body.match(/wrong on\s+([a-r])/i);
  if (wrongOnMatch) {
    const keyLetter = wrongOnMatch[1].toUpperCase();
    const question = QUESTIONS.find(q => q.key === keyLetter);

    if (question) {
      session.pendingCorrectionKey = keyLetter;
      twiml.message(
        `No problem 👌\nWhat should **${question.label}** be now?`
      );
      res.type('text/xml').send(twiml.toString());
      return;
    }
  }

  const currentQuestion = QUESTIONS[session.currentIndex];

  if (!currentQuestion) {
    twiml.message(
      'All questions are already answered ✅\nType "summary" to see them, or "reset" to start again.'
    );
    res.type('text/xml').send(twiml.toString());
    return;
  }

  session.answers[currentQuestion.key] = bodyRaw;
  session.currentIndex += 1;

  if (session.currentIndex >= QUESTIONS.length) {
    twiml.message(
      'Thanks, all fields are now completed ✅\n\nHere is your full set:\n\n' +
      buildSummary(session.answers) +
      '\n\nYou can type "N: 123" (for example) to correct, or "reset" to start a new patient.'
    );
  } else {
    const nextQuestion = QUESTIONS[session.currentIndex];
    twiml.message(`${nextQuestion.label}?`);
  }

  res.type('text/xml').send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp bot listening on port ${PORT}`);
});
