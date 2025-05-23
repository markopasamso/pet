// Güncellenmiş w.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'https://sosyal.petlebi.com/soru-cevap?page=';
const startPage = 1300;
const endPage = 1500;

const outputPath = path.join(__dirname, 'adata.json');
const uAskAndAnsPath = path.join(__dirname, 'uAskAndAns.json');
const hashIndexPath = path.join(__dirname, 'qLink_index.json');

let userIdCounter = 1;

const existingData = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
  : [];

const uAskAndAns = fs.existsSync(uAskAndAnsPath)
  ? JSON.parse(fs.readFileSync(uAskAndAnsPath, 'utf-8'))
  : {};

const qLinkIndex = fs.existsSync(hashIndexPath)
  ? JSON.parse(fs.readFileSync(hashIndexPath, 'utf-8'))
  : {};

const existingIDs = Object.values(uAskAndAns)
  .map(u => parseInt(u?.uID?.replace('u', '')))
  .filter(n => !isNaN(n));
userIdCounter = Math.max(...existingIDs, 0) + 1;

function hashNick(nick) {
  return crypto.createHash('md5').update(nick).digest('hex');
}

function hashLink(link) {
  return crypto.createHash('md5').update(link).digest('hex');
}

function cleanText(text) {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

async function fetchProfileDetails(profileUrl) {
  try {
    const { data } = await axios.get(profileUrl);
    const $ = cheerio.load(data);
    const pText = $('p.mb-2').first().text().trim();
    const name = pText.split(',')[0].trim();
    const city = $('.profil-city').first().text().trim() || '';
    const ageText = $('.text-muted').first().text().trim();
    const age = ageText.match(/\d+/)?.[0] || '';
    return { name, city, age };
  } catch {
    return { name: '', city: '', age: '' };
  }
}

async function fetchUser(nick, proLink) {
  const hash = hashNick(nick);
  if (!uAskAndAns[hash]) {
    const { name, city, age } = await fetchProfileDetails(proLink);
    const user = {
      uID: `u${userIdCounter++}`,
      uNick: nick,
      uProLink: proLink,
      uName: name,
      uCity: city,
      uAge: age
    };
    uAskAndAns[hash] = user;
    fs.writeFileSync(uAskAndAnsPath, JSON.stringify(uAskAndAns, null, 2));
  }
  return uAskAndAns[hash];
}

async function fetchQuestionDetails(qLink) {
  const answers = [];
  try {
    const { data } = await axios.get(qLink);
    const $ = cheerio.load(data);
    const qText = cleanText($('.col-md-10.col-sm-9.col-12 p').first().text());

    const qAskLinkRaw = $('.question-user-box a.nickname').first().attr('data-url') || '';
    const qAskNick = qAskLinkRaw.split('/u/')[1] || '';
    const qAskProLink = qAskLinkRaw ? `https://sosyal.petlebi.com${qAskLinkRaw}` : '';
    const qAskUser = await fetchUser(qAskNick, qAskProLink);

    const [qDate, qTime] = $('time.small').first().text().trim().split(' ');
    const qAskPawScore = $('.paw-score .badge').first().text().replace(/\D/g, '') || '';
    const qAskLikeCount = $('span[id^="question_main_count_"]').first().text().replace(/\D/g, '') || '0';

    const answerCards = $('.card.mb-3').toArray();
    for (const el of answerCards) {
      const qAnsText = cleanText($(el).find('.col-md-10.col-sm-9.col-12 p').first().text());
      const qAnsLinkRaw = $(el).find('a.nickname').first().attr('data-url') || '';
      const qAnsNick = qAnsLinkRaw.split('/u/')[1] || '';
      const qAnsProLink = qAnsLinkRaw ? `https://sosyal.petlebi.com${qAnsLinkRaw}` : '';
      const qAnsUser = await fetchUser(qAnsNick, qAnsProLink);

      const [qAnsDate, qAnsTime] = $(el).find('time.small').first().text().trim().split(' ');
      const qAnsPawScore = $(el).find('.paw-score .badge').first().text().replace(/\D/g, '') || '';
      const qAnsLikeCount = $(el).find('[id^="question_reply_count_"]').first().text().replace(/\D/g, '') || '0';

      answers.push({
        qAnsText,
        qAnsDate,
        qAnsTime,
        qAnsUID: qAnsUser.uID,
        qAnsNick: qAnsUser.uNick,
        qAnsProLink: qAnsUser.uProLink,
        qAnsName: qAnsUser.uName,
        qAnsCity: qAnsUser.uCity,
        qAnsAge: qAnsUser.uAge,
        qAnsPawScore,
        qAnsLikeCount
      });
    }

    return {
      qText,
      qDate,
      qTime,
      ...qAskUser,
      qAskPawScore,
      qAskLikeCount,
      answers
    };
  } catch {
    return {};
  }
}

async function scrapePage(page) {
  try {
    const { data } = await axios.get(`${BASE_URL}${page}`);
    const $ = cheerio.load(data);
    const cards = $('.question-card');

    for (let i = 0; i < cards.length; i++) {
      let qLink = $(cards[i]).find('.question-link').attr('href');
      if (!qLink.startsWith('http')) {
        qLink = `https://sosyal.petlebi.com${qLink}`;
      }

      const qHash = hashLink(qLink);
      const qID = `Q-${qLink.split('/').pop().split('-')[0]}`;
      const qTitle = cleanText($(cards[i]).find('.question-link').text());

      const detail = await fetchQuestionDetails(qLink);
      const lastAns = detail.answers[detail.answers.length - 1] || {};
      const currentLastAnswerDate = `${lastAns.qAnsDate || detail.qDate} ${lastAns.qAnsTime || detail.qTime}`;

      const previous = qLinkIndex[qHash];
      const existingIndex = existingData.findIndex(item => item.qLink === qLink);

      if (previous && previous.qLastAnswerDate >= currentLastAnswerDate) {
        console.log(`⏭️ Güncel değil, geçildi: ${qLink}`);
        continue;
      }

      if (existingIndex !== -1) {
        const oldAnswers = existingData[existingIndex].answers || [];
        const newAnswers = detail.answers.slice(oldAnswers.length);
        if (newAnswers.length > 0) {
          existingData[existingIndex].answers.push(...newAnswers);
          console.log(`🔁 Cevap güncellendi: ${qLink}`);
        }
      } else {
        const entry = {
          qTitle,
          qLink,
          qText: detail.qText,
          qDate: detail.qDate,
          qTime: detail.qTime,
          qAskUID: detail.uID,
          qAskNick: detail.uNick,
          qAskProLink: detail.uProLink,
          qAskName: detail.uName,
          qAskCity: detail.uCity,
          qAskAge: detail.uAge,
          qAskPawScore: detail.qAskPawScore,
          qAskLikeCount: detail.qAskLikeCount,
          answers: detail.answers
        };
        existingData.push(entry);
        console.log(`🆕 Yeni soru eklendi: ${qLink}`);
      }

      qLinkIndex[qHash] = {
        qID,
        qLink,
        qLastAnswerDate: currentLastAnswerDate
      };

      // 🔄 Her sorudan sonra dosya güncelle
      fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2));
      fs.writeFileSync(hashIndexPath, JSON.stringify(qLinkIndex, null, 2));
      fs.writeFileSync(uAskAndAnsPath, JSON.stringify(uAskAndAns, null, 2));
    }

    console.log(`✅ Sayfa ${page} tamamlandı.`);
  } catch (err) {
    console.error(`❌ Sayfa hatası (${page}): ${err.message}`);
  }
}

async function run() {
  for (let i = startPage; i <= endPage; i++) {
    await scrapePage(i);
  }
  console.log('🚀 Tüm sayfalar işlendi.');
}

run();
