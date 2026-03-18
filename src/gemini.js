const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY || 'AIzaSyA165oQtmTlprvdW40FBg7av7hVcPChne4');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function perguntar(texto) {
  try {
    const r = await model.generateContent('Responda em português brasileiro de forma util e animada com emojis: ' + texto);
    return r.response.text();
  } catch (e) { return '❌ IA indisponivel no momento. Tente novamente!'; }
}

async function horoscopo(signo) {
  try {
    const r = await model.generateContent(
      'Crie um horoscopo do dia para o signo ' + signo + ' em portugues brasileiro. Seja criativo, divertido e use emojis. Fale sobre: amor, trabalho, saude e um conselho do dia. Formato bonito com emojis.'
    );
    return r.response.text();
  } catch (e) { return '❌ Erro ao gerar horoscopo. Tente novamente!'; }
}

async function tts(texto) {
  // Retorna URL do Google TTS
  const encoded = encodeURIComponent(texto.slice(0, 200));
  return 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encoded + '&tl=pt-BR&client=tw-ob';
}

module.exports = { perguntar, horoscopo, tts };
