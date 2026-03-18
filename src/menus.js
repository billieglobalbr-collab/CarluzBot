const MENU = `*_Grupo:_ Bot Carluz 🤖 📋 _Comandos_*

🎭 */s* ou */sticker*
- Faça figurinhas de fotos, vídeos ou GIFs
- Com nome: */s amorzinho*

↩️ */revert*
- Converta uma figurinha de volta para imagem ou GIF

✒️ */ttp* [texto]
- Gera uma figurinha com o texto que você mandar

🅰️ */attp* [texto]
- Faz figurinha animada com o texto

✂️ */rmbg*
- Remove o fundo de uma imagem (marque a foto)

📄 */pdf*
- Converta uma imagem em PDF

🎵 */play* [música]
- Busque e baixe uma música do YouTube em MP3

🎧 */yta* [música]
- Baixa apenas o áudio do YouTube

▶️ */yt* [nome]
- Baixe vídeos do YouTube

🎬 */video* [nome]
- Baixe um vídeo do YouTube em MP4

🔊 */tts* [texto]
- Converta texto em áudio com a voz do Google

🤖 */ia* ou */perguntar* [pergunta]
- Converse com a IA Gemini

🔮 */h* [signo]
- Receba seu Horóscopo do dia

🎲 */dado*
- Role um dado e ganhe moedas

🪙 */moeda*
- Cara ou coroa — aposte suas moedas

🎰 */slot*
- Gire a slot machine

🎯 */roleta* [valor]
- Aposte na roleta

🎣 */pesca*
- Lance a vara e pesque itens e moedas

🃏 */blackjack*
- Jogue 21 contra o dealer

🏇 */corrida*
- Corrida de cavalos

⚔️ */duelo* @usuario [valor]
- Desafie alguém para um duelo

💰 */saldo*
- Veja suas moedas

🎁 */diario*
- Colete seu bônus diário

🏆 */ranking*
- Veja o top do grupo

🛒 */loja*
- Veja itens disponíveis

💸 */transferir* @usuario [valor]
- Transfira moedas para alguém

📋 */registrar* on/off
- Registre o grupo para usar o bot

📜 */regras*
- Veja as regras do grupo

ℹ️ */sobre*
- Informações sobre o Bot Carluz

👮 */menuadm*
- Comandos de administração (só admins)

😈 */maldade*
- Comandos malvados (só admins)`;

const MENU_ADM = `*_Bot Carluz_ 👮 _Painel do Admin_*

👥 *MEMBROS*

➕ */adicionar* [número]
- Adiciona um membro ao grupo

➖ */remover* @usuario
- Remove um membro do grupo

⬆️ */promover* @usuario
- Promove membro a administrador

⬇️ */rebaixar* @usuario
- Remove o admin de um membro

📢 */todos*
- Marca todos os membros do grupo

📣 */anuncio* [texto]
- Envia anúncio marcando todos

🔇 *SILÊNCIO*

🔇 */silenciar* @usuario
- Silencia um membro (apaga msgs)

🔊 */dessilenciar* @usuario
- Remove o silêncio de um membro

📋 */silenciados*
- Lista quem está silenciado

⚠️ *ADVERTÊNCIAS*

⚠️ */warn* @usuario
- Dá um warn (3 = expulsão)

📊 */warns* @usuario
- Vê os warns de alguém

🔄 */resetwarn* @usuario
- Zera os warns de alguém

🔒 *GRUPO*

🔒 */fechar*
- Fecha o grupo (só admins falam)

🔓 */abrir*
- Abre o grupo para todos

✏️ */renomear* [nome]
- Altera o nome do grupo

🗑️ */apagar*
- Apaga uma mensagem (responda ela)

🤖 *BOT*

✅ */registrar on*
- Ativa o bot neste grupo

❌ */registrar off*
- Desativa o bot neste grupo`;

const MENU_MALDADE = `*_Bot Carluz_ 😈 _Comandos Malvados_*

_Atenção: todos os comandos abaixo são apenas para admins!_

🔫 */russa*
- Conta regressiva dramática e remove um membro aleatório do grupo (sem admins)

💣 */bomba* [minutos]
- Sorteia uma vítima aleatória e a silencia pelo tempo escolhido
- Ex: /bomba 10

👥 */expulsaocoletiva* [quantidade]
- Remove vários membros aleatórios de uma vez
- Ex: /expulsaocoletiva 3

🔒 */cadeiavip* [minutos]
- Prende um membro aleatório na cadeia VIP e anuncia para o grupo
- Ex: /cadeiavip 15

🗳️ */votokick* @usuario
- Inicia uma votação para expulsar alguém
- 5 votos = expulsão automática
- Membros usam */votar* para votar

🕵️ */traidor*
- Revela um membro aleatório como traidor do grupo com mensagem dramática

🔓 */soltar* @usuario
- Solta alguém da cadeia antes do tempo

_Use com responsabilidade... ou não!_ 😈`;

const REGRAS = `📜 *Regras do Grupo*
━━━━━━━━━━━━━━━━━━━

1️⃣ Respeite todos os membros
2️⃣ Sem spam ou flood
3️⃣ Sem conteúdo ofensivo ou preconceito
4️⃣ Sem divulgação sem autorização
5️⃣ Não compartilhe dados pessoais
6️⃣ Respeite as decisões dos admins
7️⃣ Divirta-se! 😄

⚠️ _Descumprimento = warn ou ban_`;

const SOBRE = `🤖 *Bot Carluz*
━━━━━━━━━━━━━━━━━━━

Bot completo para WhatsApp com:
• Figurinhas e conversão de mídia
• Download de música e vídeo
• IA Gemini ao vivo
• Jogos e sistema de moedas
• Moderação completa de grupo
• Comandos malvados 😈

🛠️ Node.js + Baileys + Gemini AI
📱 Plataforma: WhatsApp`;

const LOJA = `🛒 *Loja — Bot Carluz*
━━━━━━━━━━━━━━━━━━━

🛡️ *Escudo Anti-Maldade* — 200 moedas
   _Proteção contra /roletarussa e /bomba_

⚖️ *Advogado VIP* — 300 moedas
   _Sai da cadeia na hora_

🎯 *Mira Certeira* — 150 moedas
   _+20% de ganhos nos jogos_

👑 *Título de Rei/Rainha* — 500 moedas
   _Título exclusivo no perfil_

💎 *Diamante* — 1000 moedas
   _Item mais raro da loja!_

_Use /comprar [nome do item]_
_Use /saldo para ver suas moedas_`;

const ITENS_LOJA = {
  'escudo anti-maldade': { preco: 200, emoji: '🛡️', nome: 'Escudo Anti-Maldade' },
  'advogado vip': { preco: 300, emoji: '⚖️', nome: 'Advogado VIP' },
  'mira certeira': { preco: 150, emoji: '🎯', nome: 'Mira Certeira' },
  'titulo de rei': { preco: 500, emoji: '👑', nome: 'Título de Rei/Rainha' },
  'diamante': { preco: 1000, emoji: '💎', nome: 'Diamante' }
};

const SIGNOS = {
  'aries': '♈', 'touro': '♉', 'gemeos': '♊', 'gemêos': '♊',
  'cancer': '♋', 'câncer': '♋', 'leao': '♌', 'leão': '♌',
  'virgem': '♍', 'libra': '♎', 'escorpiao': '♏', 'escorpião': '♏',
  'sagitario': '♐', 'sagitário': '♐', 'capricornio': '♑', 'capricórnio': '♑',
  'aquario': '♒', 'aquário': '♒', 'peixes': '♓'
};

module.exports = { MENU, MENU_ADM, MENU_MALDADE, REGRAS, SOBRE, LOJA, ITENS_LOJA, SIGNOS };
