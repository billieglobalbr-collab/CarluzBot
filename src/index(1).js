const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino   = require('pino');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { exec } = require('child_process');
const sharp  = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const db     = require('./database');
const gemini = require('./gemini');
const m      = require('./menus');

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');
[AUTH_DIR, TEMP_DIR].forEach(function(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

let qrAtual = null, botOnline = false, tentativas = 0;
let logMsgs = ['Bot Carluz iniciando...'];
const silenciados = new Set();
const warns = {};
const votacoes = {};
const blackjackGames = {};

function addLog(msg) {
  const t = new Date().toLocaleTimeString('pt-BR');
  logMsgs.push('[' + t + '] ' + msg);
  if (logMsgs.length > 30) logMsgs.shift();
  console.log(msg);
}

// ─── Servidor Web ───
http.createServer(function(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (botOnline) return res.end('<!DOCTYPE html><html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px"><h1>🤖 Bot Carluz</h1><h2 style="color:#0f0">✅ ONLINE!</h2><p>Use /registrar on no grupo!</p></body></html>');
  if (qrAtual) {
    const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrAtual);
    return res.end('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="20"></head><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px"><h1>🤖 Bot Carluz</h1><h2>📱 Escaneie o QR Code</h2><img src="' + qr + '" style="border:4px solid #fff;border-radius:10px;width:280px;margin:20px"/><p style="color:#f44">Expira em 60s — página atualiza sozinha</p><p>WhatsApp > Dispositivos conectados > Conectar dispositivo</p></body></html>');
  }
  const logs = logMsgs.map(function(l) { return '<div style="font-size:11px;color:#aaa;text-align:left">' + l + '</div>'; }).join('');
  res.end('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"></head><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px"><h1>🤖 Bot Carluz</h1><h2>⏳ Aguardando QR Code...</h2><div style="background:#222;padding:15px;border-radius:8px;margin:20px auto;max-width:500px">' + logs + '</div></body></html>');
}).listen(PORT, function() { addLog('Servidor web porta ' + PORT); });

// ─── Utils ───
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function isGrupo(jid) { return jid.endsWith('@g.us'); }
function tmpFile(ext) { return path.join(TEMP_DIR, 'f' + Date.now() + Math.random().toString(36).slice(2) + '.' + ext); }
function getNumero(jid) { return jid.split('@')[0].replace(/[^0-9]/g, ''); }
function toJid(n) { return n.replace(/[^0-9]/g, '') + '@s.whatsapp.net'; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function isAdmin(sock, grupo, jid) {
  try {
    const meta = await sock.groupMetadata(grupo);
    return meta.participants.filter(function(p) { return p.admin; }).some(function(p) { return p.id === jid; });
  } catch (e) { return false; }
}

async function getMembrosNaoAdmin(sock, grupo) {
  try {
    const meta = await sock.groupMetadata(grupo);
    return meta.participants.filter(function(p) { return !p.admin; }).map(function(p) { return p.id; });
  } catch (e) { return []; }
}

async function getTodosMembros(sock, grupo) {
  try {
    const meta = await sock.groupMetadata(grupo);
    return meta.participants.map(function(p) { return p.id; });
  } catch (e) { return []; }
}

function getMencionados(message) {
  if (!message) return [];
  const ctx = (message.extendedTextMessage && message.extendedTextMessage.contextInfo) ||
              (message.imageMessage && message.imageMessage.contextInfo) ||
              (message.videoMessage && message.videoMessage.contextInfo);
  return (ctx && ctx.mentionedJid) || [];
}

// ─── Download YouTube ───
function downloadYT(query, tipo) {
  return new Promise(function(resolve, reject) {
    const base = tmpFile(tipo === 'audio' ? 'mp3' : 'mp4');
    const opts = tipo === 'audio'
      ? '--extract-audio --audio-format mp3 --audio-quality 0 --max-filesize 50m'
      : '--format "best[filesize<50M]/best" --max-filesize 50m';
    const cmd = 'yt-dlp ' + opts + ' -o "' + base.replace(/\.\w+$/, '') + '.%(ext)s" "ytsearch1:' + query + '"';
    exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
      if (err) { reject(new Error(stderr || err.message)); return; }
      const dir = path.dirname(base), bn = path.basename(base).replace(/\.\w+$/, '');
      const files = fs.readdirSync(dir).filter(function(f) { return f.startsWith(bn); });
      if (!files.length) { reject(new Error('Arquivo nao encontrado')); return; }
      resolve(path.join(dir, files[0]));
    });
  });
}

// ─── Sticker ───
async function imagemParaSticker(buffer) {
  return await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
}

function videoParaSticker(buf, ext) {
  return new Promise(function(resolve, reject) {
    const inp = tmpFile(ext), out = tmpFile('webp');
    fs.writeFileSync(inp, buf);
    ffmpeg(inp)
      .outputOptions(['-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15', '-vcodec', 'libwebp', '-lossless', '0', '-quality', '80', '-loop', '0', '-preset', 'default', '-an', '-vsync', '0', '-t', '8'])
      .toFormat('webp')
      .on('end', function() { const r = fs.readFileSync(out); try { fs.unlinkSync(inp); fs.unlinkSync(out); } catch (e) {} resolve(r); })
      .on('error', function(e) { try { fs.unlinkSync(inp); } catch (e2) {} reject(e); })
      .save(out);
  });
}

async function processarSticker(sock, msg, from, mediaMsg, mediaType, nome) {
  const reply = function(t) { return sock.sendMessage(from, { text: t }, { quoted: msg }); };
  try {
    await reply(nome ? 'Criando sticker ' + nome + '...' : '⏳ Criando sticker...');
    const buf = await downloadMediaMessage({ key: msg.key, message: msg.message }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
    let sticker;
    if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') sticker = await imagemParaSticker(buf);
    else if (mediaType === 'videoMessage') sticker = await videoParaSticker(buf, (mediaMsg.mimetype || '').includes('mp4') ? 'mp4' : 'mov');
    else return reply('Tipo nao suportado! Envie imagem, video ou GIF com /s');
    await sock.sendMessage(from, { sticker: sticker });
  } catch (e) { addLog('Erro sticker: ' + e.message); await reply('Erro ao criar sticker! Tente novamente.'); }
}

// ─── TTP — Texto em Figurinha ───
async function ttpSticker(sock, from, msg, texto, animado) {
  const reply = function(t) { return sock.sendMessage(from, { text: t }, { quoted: msg }); };
  try {
    // Cria imagem PNG com texto usando sharp + SVG
    const svg = '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="' + (animado ? '#1a1a2e' : 'transparent') + '"/><text x="256" y="256" font-size="60" font-family="Arial" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" stroke="black" stroke-width="3">' + texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 30) + '</text></svg>';
    const buf = Buffer.from(svg);
    const webp = await sharp(buf).resize(512, 512).webp({ quality: 80 }).toBuffer();
    await sock.sendMessage(from, { sticker: webp });
  } catch (e) { await reply('Erro ao criar figurinha de texto! Tente um texto menor.'); }
}

// ─── Remove fundo de imagem ───
async function removerFundo(sock, from, msg, buffer) {
  const reply = function(t) { return sock.sendMessage(from, { text: t }, { quoted: msg }); };
  try {
    await reply('✂️ Removendo fundo da imagem...\n_Processando..._');
    // Usa sharp para criar versão com fundo transparente (versão simples)
    const result = await sharp(buffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sock.sendMessage(from, { image: result, caption: '✅ Fundo removido!\n\n_Dica: Para melhor resultado, use imagens com fundo simples._' }, { quoted: msg });
  } catch (e) { await reply('❌ Erro ao remover fundo! Tente com outra imagem.'); }
}

// ─── Converter Figurinha -> Imagem ───
async function reverterSticker(sock, from, msg, buffer) {
  try {
    const img = await sharp(buffer).png().toBuffer();
    await sock.sendMessage(from, { image: img, caption: '↩️ Figurinha convertida para imagem!' }, { quoted: msg });
  } catch (e) { await sock.sendMessage(from, { text: 'Erro ao converter figurinha!' }, { quoted: msg }); }
}

// ─── PDF ───
async function criarPDF(sock, from, msg, buffer) {
  const reply = function(t) { return sock.sendMessage(from, { text: t }, { quoted: msg }); };
  try {
    await reply('📄 Convertendo imagem para PDF...');
    // Cria PDF simples com a imagem
    const imgPath = tmpFile('png');
    const pdfPath = tmpFile('pdf');
    await sharp(buffer).png().toFile(imgPath);
    // Usa ImageMagick para converter
    await new Promise(function(resolve, reject) {
      exec('convert "' + imgPath + '" "' + pdfPath + '"', function(err) {
        if (err) reject(err); else resolve();
      });
    });
    const pdfBuf = fs.readFileSync(pdfPath);
    await sock.sendMessage(from, { document: pdfBuf, mimetype: 'application/pdf', fileName: 'imagem.pdf', caption: '📄 Aqui está seu PDF!' }, { quoted: msg });
    try { fs.unlinkSync(imgPath); fs.unlinkSync(pdfPath); } catch (e) {}
  } catch (e) { await reply('❌ Erro ao criar PDF! Tente com outra imagem.'); }
}

// ─── Jogos ───
function jogarDado() { const n = rand(1, 6); return { num: n, coins: [0, 5, 10, 20, 30, 50][n - 1] }; }
function jogarMoeda() { return Math.random() < 0.5 ? { r: 'CARA 🪙', ganhou: true, coins: 15 } : { r: 'COROA 🔴', ganhou: false, coins: -5 }; }
function jogarSlot() {
  const s = ['🔴', '⚫', '🎰', '💎', '⭐', '🃏'];
  const r = [0, 1, 2].map(function() { return s[rand(0, s.length - 1)]; });
  let c = -15, res = 'Sem combo 😢';
  if (r[0] === r[1] && r[1] === r[2]) { c = r[0] === '💎' ? 500 : 200; res = c === 500 ? '💎 JACKPOT!' : '🎉 TRES IGUAIS!'; }
  else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) { c = 30; res = '✨ Dois iguais!'; }
  return { r: r, coins: c, res: res };
}
function jogarRoleta(val) {
  const n = rand(0, 36);
  const cor = n === 0 ? 'Verde 🟢' : n % 2 === 0 ? 'Vermelho 🔴' : 'Preto ⚫';
  const ganhou = n > 0 && Math.random() < 0.486;
  return { n: n, cor: cor, ganhou: ganhou, coins: ganhou ? val : -val };
}
function jogarPesca() {
  const r = Math.random();
  if (r < 0.05) return { item: 'TUBARAO GIGANTE 🦈', coins: 200 };
  if (r < 0.15) return { item: 'Atum dourado 🐟', coins: 80 };
  if (r < 0.35) return { item: 'Salmao 🐠', coins: 40 };
  if (r < 0.55) return { item: 'Peixinho 🐡', coins: 15 };
  if (r < 0.70) return { item: 'Bota velha 👢', coins: -5 };
  return { item: 'Nada... 😔', coins: 0 };
}
function novaBaralho() {
  const naipes = ['♠️', '♥️', '♦️', '♣️'], vals = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const d = [];
  naipes.forEach(function(n) { vals.forEach(function(v) { d.push(v + n); }); });
  for (let i = d.length - 1; i > 0; i--) { const j = rand(0, i); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}
function valorMao(mao) {
  let t = 0, ases = 0;
  mao.forEach(function(c) { const v = c.replace(/[^0-9AJQKa]/g, ''); if (v === 'A') { t += 11; ases++; } else if (['J', 'Q', 'K'].includes(v)) t += 10; else t += parseInt(v) || 10; });
  while (t > 21 && ases > 0) { t -= 10; ases--; }
  return t;
}

// ─── HANDLER PRINCIPAL ───
async function handleMsg(sock, msg) {
  try {
    const key = msg.key, message = msg.message;
    if (!message || key.fromMe) return;
    const from = key.remoteJid;
    if (!isGrupo(from)) return;
    const remetente = key.participant || key.remoteJid;
    const numero = getNumero(remetente);
    const pushName = msg.pushName || numero;

    const bodyRaw = message.conversation || (message.extendedTextMessage && message.extendedTextMessage.text) || (message.imageMessage && message.imageMessage.caption) || (message.videoMessage && message.videoMessage.caption) || '';
    const body = bodyRaw.trim().toLowerCase();

    const reply = function(text, opts) { return sock.sendMessage(from, Object.assign({ text: text }, opts || {}), { quoted: msg }); };

    // ─── /registrar ───
    if (body === '/registrar on' || body === '/registrar off') {
      const adm = await isAdmin(sock, from, remetente);
      if (!adm) return reply('🚫 Apenas administradores podem usar este comando!');
      if (body === '/registrar on') { db.ativarGrupo(from); return reply('✅ *Bot Carluz ATIVADO!*\n\nDigite */menu* para ver os comandos! 🤖'); }
      db.desativarGrupo(from); return reply('❌ *Bot Carluz DESATIVADO.*\n_/registrar on para reativar_');
    }

    if (!db.grupoAtivo(from)) return;
    db.getUsuario(numero, pushName);

    // ─── Apaga msgs de silenciados ───
    if (silenciados.has(remetente)) {
      try { await sock.sendMessage(from, { delete: key }); } catch (e) {}
      return;
    }

    // ─── Apaga msgs de presos ───
    if (db.estaPreso(from, remetente)) {
      try { await sock.sendMessage(from, { delete: key }); } catch (e) {}
      return;
    }

    const mediaType = Object.keys(message).find(function(k) { return ['imageMessage', 'videoMessage', 'stickerMessage'].includes(k); });

    // ─── STICKER ───
    const stickerCmds = ['/s', '/sticker', '/figurinha'];
    const isExato = stickerCmds.includes(body);
    const temNome = stickerCmds.some(function(p) { return body.startsWith(p + ' '); });
    const isSticker = isExato || temNome;
    const nomeSticker = temNome ? bodyRaw.trim().replace(/^\S+\s+/, '') : '';
    if (mediaType && isSticker) return await processarSticker(sock, msg, from, message[mediaType], mediaType, nomeSticker);
    if (isSticker && message.extendedTextMessage && message.extendedTextMessage.contextInfo && message.extendedTextMessage.contextInfo.quotedMessage) {
      const q = message.extendedTextMessage.contextInfo.quotedMessage;
      const qt = Object.keys(q).find(function(k) { return ['imageMessage', 'videoMessage', 'stickerMessage'].includes(k); });
      if (qt) { const qm = { key: { remoteJid: from, id: message.extendedTextMessage.contextInfo.stanzaId, participant: message.extendedTextMessage.contextInfo.participant }, message: q }; return await processarSticker(sock, qm, from, q[qt], qt, nomeSticker); }
    }
    if (isSticker) return reply('Envie uma imagem/video/GIF com /s na legenda\nou responda uma midia com /s\n\nCom nome: /s amorzinho');

    // ─── MENUS ───
    if (body === '/menu') return reply(m.MENU);
    if (body === '/menuadm' || body === '/menoadm') {
      const adm = await isAdmin(sock, from, remetente);
      if (!adm) return reply('🚫 Apenas administradores podem ver o menu admin!');
      return reply(m.MENU_ADM);
    }
    if (body === '/maldade' || body === '/menumaldade') {
      const adm = await isAdmin(sock, from, remetente);
      if (!adm) return reply('😈 Apenas administradores podem ver os comandos malvados!');
      return reply(m.MENU_MALDADE);
    }
    if (body === '/regras') return reply(m.REGRAS);
    if (body === '/sobre') return reply(m.SOBRE);
    if (body === '/loja') return reply(m.LOJA);

    // ─── REVERT (figurinha -> imagem) ───
    if (body === '/revert') {
      if (mediaType === 'stickerMessage') {
        const buf = await downloadMediaMessage({ key: msg.key, message: msg.message }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        return await reverterSticker(sock, from, msg, buf);
      }
      if (message.extendedTextMessage && message.extendedTextMessage.contextInfo && message.extendedTextMessage.contextInfo.quotedMessage) {
        const q = message.extendedTextMessage.contextInfo.quotedMessage;
        if (q.stickerMessage) {
          const qm = { key: { remoteJid: from, id: message.extendedTextMessage.contextInfo.stanzaId, participant: message.extendedTextMessage.contextInfo.participant }, message: q };
          const buf = await downloadMediaMessage(qm, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
          return await reverterSticker(sock, from, msg, buf);
        }
      }
      return reply('Marque uma figurinha com /revert para converter em imagem!');
    }

    // ─── TTP ───
    if (body.startsWith('/ttp ') || body.startsWith('/attp ')) {
      const animado = body.startsWith('/attp');
      const texto = bodyRaw.replace(/^\/(ttp|attp)\s+/i, '').trim();
      if (!texto) return reply('Use: /ttp [texto]\nEx: /ttp Billie Eilish');
      return await ttpSticker(sock, from, msg, texto, animado);
    }

    // ─── RMBG ───
    if (body === '/rmbg') {
      let buf = null;
      if (mediaType === 'imageMessage') buf = await downloadMediaMessage({ key: msg.key, message: msg.message }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
      else if (message.extendedTextMessage && message.extendedTextMessage.contextInfo && message.extendedTextMessage.contextInfo.quotedMessage) {
        const q = message.extendedTextMessage.contextInfo.quotedMessage;
        if (q.imageMessage) { const qm = { key: { remoteJid: from, id: message.extendedTextMessage.contextInfo.stanzaId, participant: message.extendedTextMessage.contextInfo.participant }, message: q }; buf = await downloadMediaMessage(qm, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }); }
      }
      if (!buf) return reply('Marque ou responda uma imagem com /rmbg!');
      return await removerFundo(sock, from, msg, buf);
    }

    // ─── PDF ───
    if (body === '/pdf') {
      let buf = null;
      if (mediaType === 'imageMessage') buf = await downloadMediaMessage({ key: msg.key, message: msg.message }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
      else if (message.extendedTextMessage && message.extendedTextMessage.contextInfo && message.extendedTextMessage.contextInfo.quotedMessage) {
        const q = message.extendedTextMessage.contextInfo.quotedMessage;
        if (q.imageMessage) { const qm = { key: { remoteJid: from, id: message.extendedTextMessage.contextInfo.stanzaId, participant: message.extendedTextMessage.contextInfo.participant }, message: q }; buf = await downloadMediaMessage(qm, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }); }
      }
      if (!buf) return reply('Marque ou responda uma imagem com /pdf!');
      return await criarPDF(sock, from, msg, buf);
    }

    // ─── PLAY / YTA / VIDEO / YT ───
    if (body.startsWith('/play ') || body.startsWith('/yta ')) {
      const query = bodyRaw.replace(/^\/(play|yta)\s+/i, '').trim();
      if (!query) return reply('Use: /play [musica]\nEx: /play Shape of You Ed Sheeran');
      await reply('🎵 Baixando *' + query + '*...\nAguarde!');
      try {
        const fp = await downloadYT(query, 'audio');
        await sock.sendMessage(from, { audio: { url: fp }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
        try { fs.unlinkSync(fp); } catch (e) {}
      } catch (e) { await reply('❌ Nao consegui baixar! Verifique o nome e tente novamente.'); }
      return;
    }
    if (body.startsWith('/video ') || body.startsWith('/yt ')) {
      const query = bodyRaw.replace(/^\/(video|yt)\s+/i, '').trim();
      if (!query) return reply('Use: /video [nome]\nEx: /video MV Bad Guy Billie Eilish');
      await reply('🎬 Baixando video *' + query + '*...\nAguarde!');
      try {
        const fp = await downloadYT(query, 'video');
        await sock.sendMessage(from, { video: { url: fp }, mimetype: 'video/mp4', caption: '🎬 ' + query }, { quoted: msg });
        try { fs.unlinkSync(fp); } catch (e) {}
      } catch (e) { await reply('❌ Nao consegui baixar! Verifique o nome e tente novamente.'); }
      return;
    }

    // ─── TTS ───
    if (body.startsWith('/tts ')) {
      const texto = bodyRaw.replace(/^\/tts\s+/i, '').trim();
      if (!texto) return reply('Use: /tts [texto]\nEx: /tts Ola mundo');
      try {
        const url = await gemini.tts(texto);
        await sock.sendMessage(from, { audio: { url: url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
      } catch (e) { await reply('❌ Erro no TTS! Tente novamente.'); }
      return;
    }

    // ─── IA ───
    if (body.startsWith('/ia ') || body.startsWith('/perguntar ')) {
      const q = bodyRaw.replace(/^\/(ia|perguntar)\s+/i, '').trim();
      if (!q) return reply('Use: /ia [pergunta]\nEx: /ia qual e a capital do Brasil?');
      await reply('🤖 Consultando IA...');
      return reply(await gemini.perguntar(q));
    }

    // ─── HOROSCOPO ───
    if (body.startsWith('/h ') || body.startsWith('/horoscopo ')) {
      const signo = body.replace(/^\/(h|horoscopo)\s+/i, '').trim();
      if (!signo) return reply('Use: /h [signo]\nEx: /h aries');
      const emoji = m.SIGNOS[signo] || '⭐';
      await reply('🔮 Gerando horoscopo de ' + emoji + ' ' + signo + '...');
      return reply(await gemini.horoscopo(signo));
    }

    // ─── JOGOS ───
    if (body === '/dado') {
      const r = jogarDado();
      const s = db.atualizarSaldo(numero, r.coins);
      const e = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣'];
      return reply('🎲 *Dado*\n\n' + pushName + ' tirou *' + e[r.num-1] + ' (' + r.num + ')*\n\n' + (r.coins > 0 ? '💰 +' + r.coins + ' moedas!' : '😢 Sem moedas!') + '\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body === '/moeda') {
      const r = jogarMoeda();
      const s = db.atualizarSaldo(numero, r.coins);
      return reply('🪙 *Cara ou Coroa*\n\n' + pushName + ': *' + r.r + '*\n\n' + (r.ganhou ? '💰 +' + r.coins : '😢 -' + Math.abs(r.coins)) + ' moedas\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body === '/slot') {
      const r = jogarSlot();
      const s = db.atualizarSaldo(numero, r.coins);
      return reply('🎰 *Slot Machine*\n\n┌───────────────┐\n│  ' + r.r[0] + '   ' + r.r[1] + '   ' + r.r[2] + '  │\n└───────────────┘\n\n*' + r.res + '*\n' + (r.coins > 0 ? '💰 +' + r.coins : '😢 ' + r.coins) + ' moedas\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body.startsWith('/roleta')) {
      const val = parseInt(body.split(' ')[1]) || 20;
      const u = db.getUsuario(numero);
      if (u.saldo < val) return reply('❌ Saldo insuficiente! Voce tem ' + u.saldo + ' moedas.');
      const r = jogarRoleta(val);
      const s = db.atualizarSaldo(numero, r.coins);
      return reply('🎯 *Roleta*\n\n' + pushName + ' apostou *' + val + ' moedas*!\n\nCaiu no *' + r.n + '* — ' + r.cor + '\n\n' + (r.ganhou ? '💰 GANHOU! +' + r.coins + ' moedas!' : '😢 Perdeu! -' + Math.abs(r.coins) + ' moedas') + '\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body === '/pesca') {
      const r = jogarPesca();
      const s = db.atualizarSaldo(numero, r.coins);
      return reply('🎣 *Pesca*\n\n' + pushName + ' lancou a vara...\n\n🎣 Pescou: *' + r.item + '*\n\n' + (r.coins > 0 ? '💰 +' + r.coins + ' moedas!' : r.coins < 0 ? '😢 -' + Math.abs(r.coins) + ' moedas' : '😐 Nada') + '\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body === '/corrida') {
      const cavalos = ['🐴 Relampago', '🐎 Trovao', '🏇 Ventania', '🦄 Magico', '🐖 Porquinho (nao aposte)'];
      await reply('🏇 *Corrida de Cavalos!*\n\n' + cavalos.join('\n') + '\n\n🏁 A corrida comeca em 3 segundos...');
      await sleep(3000);
      const vencedor = cavalos[rand(0, cavalos.length - 1)];
      const ganhou = Math.random() < 0.35;
      const prize = ganhou ? 60 : -25;
      const s = db.atualizarSaldo(numero, prize);
      return reply('🏆 *Resultado!*\n\nVencedor: *' + vencedor + '*\n\n' + (ganhou ? '💰 ' + pushName + ' ganhou! +60 moedas!' : '😢 ' + pushName + ' perdeu! -25 moedas') + '\n💰 Saldo: *' + s + ' moedas*');
    }
    if (body === '/blackjack') {
      const u = db.getUsuario(numero);
      if (u.saldo < 30) return reply('Saldo insuficiente! Precisa de 30 moedas para jogar blackjack.');
      const deck = novaBaralho();
      const jogador = [deck.shift(), deck.shift()], dealer = [deck.shift(), deck.shift()];
      blackjackGames[numero] = { deck: deck, jogador: jogador, dealer: dealer };
      db.atualizarSaldo(numero, -30);
      const vJ = valorMao(jogador);
      return reply('🃏 *Blackjack*\n\nAposta: 30 moedas\n\nSuas cartas: ' + jogador.join(' ') + '\nValor: *' + vJ + '*\nDealer mostra: ' + dealer[0] + '\n\n' + (vJ === 21 ? 'BLACKJACK! Use /bj-parar!' : '/bj-pedir — mais uma carta\n/bj-parar — encerrar'));
    }
    if (body === '/bj-pedir') {
      const j = blackjackGames[numero];
      if (!j) return reply('Sem jogo! Use /blackjack para comecar.');
      j.jogador.push(j.deck.shift());
      const v = valorMao(j.jogador);
      if (v > 21) { delete blackjackGames[numero]; return reply('🃏 *Blackjack*\n\n' + j.jogador.join(' ') + ' = *' + v + '*\n\n💥 ESTOUROU! -30 moedas\n💰 Saldo: *' + db.getUsuario(numero).saldo + ' moedas*'); }
      return reply('🃏 ' + j.jogador.join(' ') + ' = *' + v + '*\n' + (v === 21 ? 'BLACKJACK! /bj-parar!' : '/bj-pedir ou /bj-parar'));
    }
    if (body === '/bj-parar') {
      const j = blackjackGames[numero];
      if (!j) return reply('Sem jogo! Use /blackjack para comecar.');
      while (valorMao(j.dealer) < 17) j.dealer.push(j.deck.shift());
      const vJ = valorMao(j.jogador), vD = valorMao(j.dealer);
      delete blackjackGames[numero];
      let res, ganho;
      if (vD > 21 || vJ > vD) { res = 'VOCE GANHOU! 🎉'; ganho = 60; }
      else if (vJ === vD) { res = 'EMPATE!'; ganho = 30; }
      else { res = 'DEALER GANHOU! 😢'; ganho = 0; }
      const s = db.atualizarSaldo(numero, ganho);
      return reply('🃏 *Blackjack — Resultado*\n\nSuas: ' + j.jogador.join(' ') + ' = *' + vJ + '*\nDealer: ' + j.dealer.join(' ') + ' = *' + vD + '*\n\n*' + res + '*\n' + (ganho > 0 ? '💰 +' + ganho + ' moedas' : '😢 -30 moedas') + '\n💰 Saldo: *' + s + ' moedas*');
    }

    // ─── MOEDAS ───
    if (body === '/saldo') {
      const u = db.getUsuario(numero, pushName);
      return reply('💰 *Saldo — ' + pushName + '*\n\n💰 *' + u.saldo + ' moedas*\n\n_/diario para bonus diario!_');
    }
    if (body === '/diario') {
      const r = db.coletarDiario(numero, pushName);
      if (!r.sucesso) return reply('⏰ Ja coletou hoje! Volte amanha.\n_Saldo: ' + r.saldo + ' moedas_');
      return reply('🎁 *Bonus Diario!*\n\n' + pushName + ' coletou *+75 moedas*!\n💰 Saldo: *' + r.saldo + ' moedas*\n\n_Volte amanha!_');
    }
    if (body === '/ranking') {
      const rows = db.getRanking(10);
      if (!rows.length) return reply('Ranking vazio! Use /diario para ganhar moedas.');
      const med = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
      return reply('🏆 *Ranking*\n\n' + rows.map(function(r, i) { return med[i] + ' ' + (r.nome || r.numero) + ' — ' + r.saldo + ' moedas'; }).join('\n') + '\n\n_/diario para ganhar moedas!_');
    }
    if (body === '/inventario') {
      const itens = db.getInventario(numero);
      if (!itens.length) return reply('🎒 Inventario vazio! Use /loja para comprar.');
      return reply('🎒 *Inventario — ' + pushName + '*\n\n' + itens.map(function(i) { return '• ' + i.item; }).join('\n'));
    }
    if (body.startsWith('/comprar ')) {
      const k = body.slice(9).trim(), item = m.ITENS_LOJA[k];
      if (!item) return reply('Item nao encontrado! Use /loja para ver os itens.');
      const u = db.getUsuario(numero);
      if (db.temItem(numero, item.nome)) return reply('Voce ja tem *' + item.nome + '*!');
      if (u.saldo < item.preco) return reply('Saldo insuficiente! Voce tem ' + u.saldo + ', precisa de ' + item.preco + ' moedas.');
      db.atualizarSaldo(numero, -item.preco);
      db.addInventario(numero, item.nome);
      return reply(item.emoji + ' Comprou *' + item.nome + '*!\n-' + item.preco + ' moedas\n💰 Saldo: *' + db.getUsuario(numero).saldo + ' moedas*');
    }
    if (body.startsWith('/transferir ')) {
      const mencionados = getMencionados(message);
      const val = parseInt(body.split(' ').pop());
      if (isNaN(val) || val <= 0) return reply('Use: /transferir @usuario 50');
      if (!mencionados.length) return reply('Mencione o usuario!');
      const ok = db.transferir(numero, getNumero(mencionados[0]), val);
      if (!ok) return reply('Saldo insuficiente!');
      return sock.sendMessage(from, { text: '💸 ' + pushName + ' transferiu *' + val + ' moedas* para @' + getNumero(mencionados[0]) + '!', mentions: mencionados }, { quoted: msg });
    }

    // ─── VOTAR ───
    if (body === '/votar') {
      const vote = votacoes[from];
      if (!vote) return reply('Nenhuma votacao ativa! Admin use /votokick @usuario');
      if (vote.iniciado_por === remetente) return reply('Voce nao pode votar na propria votacao!');
      const ok = db.addVoto(from, vote.alvo, remetente);
      if (!ok) return reply('Voce ja votou nesta votacao!');
      const total = db.getVotos(from, vote.alvo);
      await reply('🗳️ Voto registrado! ' + total + '/5 votos para expulsar @' + getNumero(vote.alvo), { mentions: [vote.alvo] });
      if (total >= 5) {
        db.limparVotos(from, vote.alvo);
        delete votacoes[from];
        try {
          await sock.groupParticipantsUpdate(from, [vote.alvo], 'remove');
          return sock.sendMessage(from, { text: '🚫 *EXPULSO POR VOTACAO!*\n\n@' + getNumero(vote.alvo) + ' foi expulso do grupo por votacao popular! 5/5 votos atingidos!', mentions: [vote.alvo] });
        } catch (e) { return reply('Votacao encerrada mas nao consegui expulsar. Verifique as permissoes do bot!'); }
      }
      return;
    }

    if (!body.startsWith('/')) {
      if (['oi', 'ola', 'olá', 'hello', 'oi!'].includes(body)) return reply('👋 Oi, ' + pushName + '! Sou o *Bot Carluz* 🤖\nDigite */menu* para ver os comandos!');
      return;
    }

    // ─── COMANDOS DE ADMIN ───
    const adm = await isAdmin(sock, from, remetente);
    const semPerm = function() { return reply('🚫 Apenas *administradores* podem usar este comando!'); };
    const mencionados = getMencionados(message);

    if (body === '/admin') return reply('Use /menuadm para ver os comandos de admin!');

    if (body.startsWith('/remover') || body.startsWith('/kick')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario! /remover @usuario');
      for (let i = 0; i < mencionados.length; i++) { try { await sock.groupParticipantsUpdate(from, [mencionados[i]], 'remove'); await sleep(500); } catch (e) {} }
      return reply('✅ ' + mencionados.length + ' membro(s) removido(s)!');
    }
    if (body.startsWith('/adicionar') || body.startsWith('/add')) {
      if (!adm) return semPerm();
      const nums = body.split(' ').slice(1).map(function(p) { return p.replace(/[^0-9]/g, ''); }).filter(function(n) { return n.length >= 8; });
      mencionados.forEach(function(j) { const n = getNumero(j); if (!nums.includes(n)) nums.push(n); });
      if (!nums.length) return reply('Informe o numero! /adicionar 5511999999999');
      for (let i = 0; i < nums.length; i++) { try { await sock.groupParticipantsUpdate(from, [toJid(nums[i])], 'add'); await sleep(500); } catch (e) {} }
      return reply('✅ ' + nums.length + ' membro(s) adicionado(s)!');
    }
    if (body.startsWith('/silenciar') || body.startsWith('/mute')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      mencionados.forEach(function(j) { silenciados.add(j); });
      return sock.sendMessage(from, { text: '🔇 ' + mencionados.map(function(j) { return '@' + getNumero(j); }).join(', ') + ' silenciado(s)!\nMensagens serao apagadas. Use /dessilenciar para remover.', mentions: mencionados }, { quoted: msg });
    }
    if (body.startsWith('/dessilenciar') || body.startsWith('/unmute')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      mencionados.forEach(function(j) { silenciados.delete(j); });
      return sock.sendMessage(from, { text: '🔊 ' + mencionados.map(function(j) { return '@' + getNumero(j); }).join(', ') + ' dessilenciado(s)!', mentions: mencionados }, { quoted: msg });
    }
    if (body === '/silenciados') {
      if (!adm) return semPerm();
      if (!silenciados.size) return reply('Nenhuma pessoa silenciada!');
      return sock.sendMessage(from, { text: '🔇 *Silenciados:*\n\n' + Array.from(silenciados).map(function(j) { return '• @' + getNumero(j); }).join('\n'), mentions: Array.from(silenciados) }, { quoted: msg });
    }
    if (body.startsWith('/promover')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      for (let i = 0; i < mencionados.length; i++) { try { await sock.groupParticipantsUpdate(from, [mencionados[i]], 'promote'); await sleep(500); } catch (e) {} }
      return sock.sendMessage(from, { text: '⬆️ Promovido(s) a administrador!', mentions: mencionados }, { quoted: msg });
    }
    if (body.startsWith('/rebaixar')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      for (let i = 0; i < mencionados.length; i++) { try { await sock.groupParticipantsUpdate(from, [mencionados[i]], 'demote'); await sleep(500); } catch (e) {} }
      return sock.sendMessage(from, { text: '⬇️ Rebaixado(s) de administrador!', mentions: mencionados }, { quoted: msg });
    }
    if (body === '/fechar') { if (!adm) return semPerm(); try { await sock.groupSettingUpdate(from, 'announcement'); return reply('🔒 Grupo fechado! Apenas admins podem enviar mensagens.'); } catch (e) { return reply('Erro ao fechar grupo!'); } }
    if (body === '/abrir') { if (!adm) return semPerm(); try { await sock.groupSettingUpdate(from, 'not_announcement'); return reply('🔓 Grupo aberto! Todos podem enviar mensagens.'); } catch (e) { return reply('Erro ao abrir grupo!'); } }
    if (body.startsWith('/renomear ')) {
      if (!adm) return semPerm();
      const nome = bodyRaw.replace(/^\/renomear\s+/i, '').trim();
      try { await sock.groupUpdateSubject(from, nome); return reply('✅ Nome alterado para *' + nome + '*!'); } catch (e) { return reply('Erro ao renomear!'); }
    }
    if (body === '/todos') {
      if (!adm) return semPerm();
      const members = await getTodosMembros(sock, from);
      return sock.sendMessage(from, { text: '📢 *Atencao!*\n\n' + members.map(function(m) { return '@' + getNumero(m); }).join(' ') + '\n\n_Mensagem de: ' + pushName + '_', mentions: members });
    }
    if (body.startsWith('/anuncio ')) {
      if (!adm) return semPerm();
      const texto = bodyRaw.replace(/^\/anuncio\s+/i, '').trim();
      const members = await getTodosMembros(sock, from);
      return sock.sendMessage(from, { text: '📣 *ANUNCIO*\n\n' + texto + '\n\n' + members.map(function(m) { return '@' + getNumero(m); }).join(' '), mentions: members });
    }
    if (body.startsWith('/warn ')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      const alvoJid = mencionados[0], alvoNum = getNumero(alvoJid);
      if (!warns[from]) warns[from] = {};
      warns[from][alvoNum] = (warns[from][alvoNum] || 0) + 1;
      const w = warns[from][alvoNum];
      let extra = '';
      if (w >= 3) { try { await sock.groupParticipantsUpdate(from, [alvoJid], 'remove'); extra = '\n\n🚫 *3 warns — expulso!*'; warns[from][alvoNum] = 0; } catch (e) {} }
      return sock.sendMessage(from, { text: '⚠️ *ADVERTENCIA!*\n\n@' + alvoNum + ' recebeu um warn! *' + w + '/3*' + extra, mentions: [alvoJid] }, { quoted: msg });
    }
    if (body.startsWith('/warns ')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      const n = getNumero(mencionados[0]);
      return reply('@' + n + ' tem *' + ((warns[from] && warns[from][n]) || 0) + '/3* warns.');
    }
    if (body.startsWith('/resetwarn ')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      const n = getNumero(mencionados[0]);
      if (warns[from]) warns[from][n] = 0;
      return reply('✅ Warns de @' + n + ' resetados!');
    }
    if (body === '/apagar' || body === '/deletar' || body === '/del') {
      if (!adm) return semPerm();
      const ctx = message.extendedTextMessage && message.extendedTextMessage.contextInfo;
      if (!ctx || !ctx.stanzaId) return reply('Responda uma mensagem para apaga-la!');
      try { await sock.sendMessage(from, { delete: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant, fromMe: false } }); } catch (e) { return reply('Nao consegui apagar! O bot precisa ser admin.'); }
    }
    if (body === '/soltar') {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!');
      const jid = mencionados[0];
      db.soltar(from, jid);
      silenciados.delete(jid);
      return sock.sendMessage(from, { text: '🔓 @' + getNumero(jid) + ' foi solto(a)!', mentions: [jid] }, { quoted: msg });
    }

    // ══════════════════════════════════════
    // 😈 COMANDOS MALVADOS
    // ══════════════════════════════════════

    // ─── /roletarussa ───
    if (body === '/roletarussa') {
      if (!adm) return semPerm();
      const membros = await getMembrosNaoAdmin(sock, from);
      if (membros.length < 2) return reply('Poucos membros para jogar!');
      const vitima = membros[rand(0, membros.length - 1)];
      const vitimaNum = getNumero(vitima);

      await sock.sendMessage(from, { text: '🔫 *ROLETA RUSSA INICIADA!*\n\nA roleta está girando...\nAlguem vai sair daqui hoje! 😈\n\nContagem regressiva:' });
      await sleep(1500);
      for (let i = 5; i >= 1; i--) {
        await sock.sendMessage(from, { text: String(i) + (i === 5 ? ' 🔫' : i === 3 ? ' 💀' : i === 1 ? ' 😱' : '') });
        await sleep(1500);
      }
      await sock.sendMessage(from, { text: '💥 *BANG!*' });
      await sleep(1000);
      await sock.sendMessage(from, { text: '💀 *A vitima foi...*\n\n@' + vitimaNum + '!!! 😈\n\n_Te vejo do outro lado!_ 👋', mentions: [vitima] });
      await sleep(1500);
      try {
        await sock.groupParticipantsUpdate(from, [vitima], 'remove');
      } catch (e) { await sock.sendMessage(from, { text: 'Tentei mas @' + vitimaNum + ' escapou! O bot precisa ser admin. 😤', mentions: [vitima] }); }
      return;
    }

    // ─── /bomba ───
    if (body.startsWith('/bomba')) {
      if (!adm) return semPerm();
      const minutos = parseInt(body.split(' ')[1]) || 10;
      const membros = await getMembrosNaoAdmin(sock, from);
      if (!membros.length) return reply('Sem membros para explodir!');
      const vitima = membros[rand(0, membros.length - 1)];
      const vitimaNum = getNumero(vitima);

      await sock.sendMessage(from, { text: '💣 *BOMBA ATIVADA!*\n\n⏱️ Contagem: ' + minutos + ' minutos\n\nAlguem vai ser atingido...' });
      await sleep(2000);
      await sock.sendMessage(from, { text: '💥 *BOOM!*\n\n@' + vitimaNum + ' foi atingido(a) pela bomba!\n\n🔇 Silenciado(a) por *' + minutos + ' minutos*! 😈', mentions: [vitima] });

      silenciados.add(vitima);
      db.prender(from, vitimaNum, vitima, minutos);

      // Solta automaticamente
      setTimeout(async function() {
        silenciados.delete(vitima);
        db.soltar(from, vitima);
        await sock.sendMessage(from, { text: '🔊 @' + vitimaNum + ' sobreviveu a bomba e voltou! 😤', mentions: [vitima] });
      }, minutos * 60000);
      return;
    }

    // ─── /expulsaocoletiva ───
    if (body.startsWith('/expulsaocoletiva')) {
      if (!adm) return semPerm();
      const qtd = Math.min(parseInt(body.split(' ')[1]) || 2, 10);
      const membros = await getMembrosNaoAdmin(sock, from);
      if (membros.length < qtd) return reply('Nao ha membros suficientes! Tem apenas ' + membros.length + ' membros nao-admin.');

      await sock.sendMessage(from, { text: '💀 *EXPULSAO COLETIVA!*\n\n' + qtd + ' membros serao removidos aleatoriamente!\n\nPreparem-se... 😈' });
      await sleep(2000);

      // Embaralha e pega os primeiros
      for (let i = membros.length - 1; i > 0; i--) { const j = rand(0, i); const t = membros[i]; membros[i] = membros[j]; membros[j] = t; }
      const escolhidos = membros.slice(0, qtd);

      await sock.sendMessage(from, { text: '🚫 *As vitimas sao:*\n\n' + escolhidos.map(function(j) { return '@' + getNumero(j); }).join('\n'), mentions: escolhidos });
      await sleep(2000);

      let removidos = 0;
      for (let i = 0; i < escolhidos.length; i++) {
        try { await sock.groupParticipantsUpdate(from, [escolhidos[i]], 'remove'); removidos++; await sleep(800); } catch (e) {}
      }
      return reply('✅ ' + removidos + '/' + qtd + ' membros removidos na expulsao coletiva! 😈');
    }

    // ─── /cadeiavip ───
    if (body.startsWith('/cadeiavip')) {
      if (!adm) return semPerm();
      const minutos = parseInt(body.split(' ')[1]) || 15;
      const membros = await getMembrosNaoAdmin(sock, from);
      if (!membros.length) return reply('Sem membros para prender!');
      const preso = membros[rand(0, membros.length - 1)];
      const presoNum = getNumero(preso);

      // Verifica se tem Escudo Anti-Maldade
      if (db.temItem(presoNum, 'Escudo Anti-Maldade')) {
        await sock.sendMessage(from, { text: '🛡️ @' + presoNum + ' tentou ser preso mas usou o *Escudo Anti-Maldade*! Imune! 😤', mentions: [preso] });
        return;
      }

      silenciados.add(preso);
      db.prender(from, presoNum, preso, minutos);

      await sock.sendMessage(from, { text: '🔒 *CADEIA VIP!*\n\n@' + presoNum + ' foi preso(a) na *Cadeia VIP*!\n\n⏱️ Pena: *' + minutos + ' minutos*\n\n🔇 Mensagens bloqueadas!\n\n_Aguenta ai, presidiario(a)!_ 😈\n\nUse /soltar @usuario para soltar antes do tempo.', mentions: [preso] });

      setTimeout(async function() {
        silenciados.delete(preso);
        db.soltar(from, preso);
        await sock.sendMessage(from, { text: '🔓 @' + presoNum + ' cumpriu a pena e saiu da Cadeia VIP! 😤\n_Bem-vindo(a) de volta, ex-presidiario(a)!_', mentions: [preso] });
      }, minutos * 60000);
      return;
    }

    // ─── /votokick ───
    if (body.startsWith('/votokick ')) {
      if (!adm) return semPerm();
      if (!mencionados.length) return reply('Mencione o usuario!\n/votokick @usuario');
      const alvo = mencionados[0];
      const alvoNum = getNumero(alvo);
      db.limparVotos(from, alvo);
      votacoes[from] = { alvo: alvo, iniciado_por: remetente };
      const members = await getTodosMembros(sock, from);
      return sock.sendMessage(from, { text: '🗳️ *VOTACAO INICIADA!*\n\nAlvo: @' + alvoNum + '\n\nMembros do grupo, votem digitando */votar* para expulsar!\n\n_5 votos = expulsao automatica!_ 😈\n\nNecessario: 5 votos', mentions: [alvo] });
    }

    // ─── /traidor ───
    if (body === '/traidor') {
      if (!adm) return semPerm();
      const membros = await getMembrosNaoAdmin(sock, from);
      if (!membros.length) return reply('Sem membros para revelar!');
      const traidor = membros[rand(0, membros.length - 1)];
      const traidorNum = getNumero(traidor);

      await sock.sendMessage(from, { text: '🕵️ *ALERTA DE SEGURANCA!*\n\nNossas investigacoes revelaram que ha um *TRAIDOR* entre nos...' });
      await sleep(2000);
      await sock.sendMessage(from, { text: '🔎 Analisando membros...' });
      await sleep(2000);
      await sock.sendMessage(from, { text: '⚠️ Identificando suspeito...' });
      await sleep(2000);
      await sock.sendMessage(from, { text: '🚨 *TRAIDOR ENCONTRADO!*\n\n@' + traidorNum + ' e o(a) *TRAIDOR(A)* do grupo! 😱\n\n_Informacoes vendidas, mensagens vazadas, lealdade zero!_\n\nO que fazemos com ele(a)? 👀', mentions: [traidor] });
      return;
    }

  } catch (err) { addLog('Erro handler: ' + err.message); }
}

// ─── Conexão ───
async function conectar() {
  tentativas++;
  addLog('Tentativa ' + tentativas + '...');
  try {
    const authState = await useMultiFileAuthState(AUTH_DIR);
    addLog('Auth OK');
    const vd = await fetchLatestBaileysVersion();
    addLog('Baileys ' + vd.version.join('.'));
    const logger = pino({ level: 'silent' });
    const sock = makeWASocket({
      version: vd.version,
      logger: logger,
      auth: { creds: authState.state.creds, keys: makeCacheableSignalKeyStore(authState.state.keys, logger) },
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });
    sock.ev.on('creds.update', authState.saveCreds);
    sock.ev.on('connection.update', async function(u) {
      if (u.qr) { qrAtual = u.qr; botOnline = false; addLog('QR Code gerado! Acesse a URL.'); }
      if (u.connection === 'close') {
        botOnline = false; qrAtual = null;
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : 0;
        addLog('Fechou. Codigo: ' + code);
        if (code === DisconnectReason.loggedOut) { try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); fs.mkdirSync(AUTH_DIR); } catch (e) {} }
        const delay = Math.min(5000 * tentativas, 30000);
        await sleep(delay);
        conectar();
      }
      if (u.connection === 'open') { tentativas = 0; qrAtual = null; botOnline = true; addLog('BOT CARLUZ ONLINE! Use /registrar on no grupo.'); }
    });
    sock.ev.on('messages.upsert', async function(upsert) {
      if (upsert.type !== 'notify') return;
      for (let i = 0; i < upsert.messages.length; i++) {
        if (!upsert.messages[i].message) continue;
        await handleMsg(sock, upsert.messages[i]);
      }
    });
    sock.ev.on('group-participants.update', async function(update) {
      if (update.action !== 'add' || !db.grupoAtivo(update.id)) return;
      for (let i = 0; i < update.participants.length; i++) {
        const p = update.participants[i];
        db.getUsuario(getNumero(p));
        await sleep(1000);
        await sock.sendMessage(update.id, { text: '👋 Bem-vindo(a) ao grupo, @' + getNumero(p) + '!\n\nDigite */menu* para ver os comandos do *Bot Carluz*! 🤖\n\nVoce ganhou *+100 moedas* de boas-vindas! 💰', mentions: [p] });
      }
    });
  } catch (err) {
    addLog('ERRO: ' + err.message);
    await sleep(Math.min(5000 * tentativas, 30000));
    conectar();
  }
}

conectar();
