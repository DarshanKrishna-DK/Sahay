// Landing page words in English, Hindi (Devanagari) and Kannada (Kannada script).
// Everything shown in the pictures is an example with invented names (see the "Example" tags).

export const LANGS = ["hi", "kn", "en"];

const S = {
  skip: { en: "Skip to content", hi: "सीधे मुख्य भाग पर जाएँ", kn: "ಮುಖ್ಯ ಭಾಗಕ್ಕೆ ಹೋಗಿ" },
  brandTop: { en: "Sahay, back to top", hi: "सहाय, ऊपर जाएँ", kn: "ಸಹಾಯ್, ಮೇಲಕ್ಕೆ ಹೋಗಿ" },
  aiChip: { en: "Automated assistant", hi: "स्वचालित सहायक", kn: "ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ" },
  navLabel: { en: "Page", hi: "पेज", kn: "ಪುಟ" },
  navHow: { en: "How it works", hi: "कैसे चलता है", kn: "ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ" },
  navYes: { en: "Your yes", hi: "आपकी हाँ", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ" },
  navSell: { en: "Bills and stock", hi: "बिल और स्टॉक", kn: "ಬಿಲ್ ಮತ್ತು ದಾಸ್ತಾನು" },
  langLabel: { en: "Language", hi: "भाषा", kn: "ಭಾಷೆ" },
  langChoose: { en: "Choose your language", hi: "अपनी भाषा चुनें", kn: "ನಿಮ್ಮ ಭಾಷೆ ಆರಿಸಿ" },
  toLight: { en: "Switch to light", hi: "रोशनी वाला रंग", kn: "ಬೆಳಕಿನ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  toDark: { en: "Switch to dark", hi: "गहरा रंग", kn: "ಗಾಢ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  start: { en: "Start talking", hi: "बात शुरू करें", kn: "ಮಾತು ಶುರು ಮಾಡಿ" },

  edgeLabel: { en: "Quick links into Sahay", hi: "सहाय में सीधे जाएँ", kn: "ಸಹಾಯ್‌ಗೆ ನೇರ ದಾರಿ" },
  edgeMenu: { en: "Quick links", hi: "सीधे रास्ते", kn: "ನೇರ ದಾರಿಗಳು" },
  edgeTalk: { en: "Talk", hi: "बोलें", kn: "ಮಾತಾಡಿ" },
  edgeType: { en: "Type", hi: "लिखें", kn: "ಬರೆಯಿರಿ" },
  edgeWork: { en: "Work", hi: "काम", kn: "ಕೆಲಸ" },
  edgeOrders: { en: "Orders", hi: "ऑर्डर", kn: "ಆರ್ಡರ್" },
  edgeMe: { en: "My Sahay", hi: "मेरा सहाय", kn: "ನನ್ನ ಸಹಾಯ್" },

  railLabel: { en: "Steps", hi: "क़दम", kn: "ಹಂತಗಳು" },
  st1: { en: "Heard you", hi: "आपकी बात सुनी", kn: "ನಿಮ್ಮ ಮಾತು ಕೇಳಿದೆ" },
  st2: { en: "Finding sellers", hi: "विक्रेता खोज", kn: "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ" },
  st3: { en: "Bargaining", hi: "मोलभाव", kn: "ಚೌಕಾಸಿ" },
  st4: { en: "Your yes", hi: "आपकी हाँ", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ" },
  st5: { en: "Learns you", hi: "आपको समझता है", kn: "ನಿಮ್ಮನ್ನು ಅರಿಯುತ್ತದೆ" },
  st6: { en: "Bills and khata", hi: "बिल और खाता", kn: "ಬಿಲ್ ಮತ್ತು ಖಾತೆ" },
  st7: { en: "Stock", hi: "स्टॉक", kn: "ದಾಸ್ತಾನು" },

  heroSub: {
    en: "Tell it what your shop needs. It finds sellers, bargains, and waits for your yes.",
    hi: "दुकान को क्या चाहिए, बताइए। सहाय विक्रेता ढूँढता है, मोलभाव करता है, और आपकी हाँ का इंतज़ार करता है।",
    kn: "ಅಂಗಡಿಗೆ ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ. ಸಹಾಯ್ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ, ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತದೆ.",
  },
  scrollCue: { en: "See how it works", hi: "देखिए कैसे चलता है", kn: "ಹೇಗೆ ಎಂದು ನೋಡಿ" },
  example: { en: "Example", hi: "उदाहरण", kn: "ಉದಾಹರಣೆ" },

  sayTitle: { en: "Say what you need", hi: "बोलिए, क्या चाहिए", kn: "ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ" },
  sayBody: {
    en: "In Hindi, Kannada or English. Sahay turns your words into a clear need.",
    hi: "हिंदी, कन्नड़ या अंग्रेज़ी में। सहाय आपकी बात को साफ़ ज़रूरत में बदलता है।",
    kn: "ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ. ಸಹಾಯ್ ನಿಮ್ಮ ಮಾತನ್ನು ಸ್ಪಷ್ಟ ಅಗತ್ಯವಾಗಿ ಬರೆಯುತ್ತದೆ.",
  },
  sayQuote: { en: "“Fifty kilos of rice, by Friday.”", hi: "“पचास किलो चावल, शुक्रवार तक।”", kn: "“ಐವತ್ತು ಕಿಲೋ ಅಕ್ಕಿ, ಶುಕ್ರವಾರದೊಳಗೆ.”" },
  needHead: { en: "Your need", hi: "आपकी ज़रूरत", kn: "ನಿಮ್ಮ ಅಗತ್ಯ" },
  needWhat: { en: "What", hi: "क्या", kn: "ಏನು" },
  needHowMuch: { en: "How much", hi: "कितना", kn: "ಎಷ್ಟು" },
  needBy: { en: "By", hi: "कब तक", kn: "ಯಾವಾಗದೊಳಗೆ" },
  rice: { en: "Rice", hi: "चावल", kn: "ಅಕ್ಕಿ" },
  qty50: { en: "50 kg", hi: "50 किलो", kn: "50 ಕಿಲೋ" },
  friday: { en: "Friday", hi: "शुक्रवार", kn: "ಶುಕ್ರವಾರ" },
  sayAlt: {
    en: "Example: the owner says fifty kilos of rice by Friday, and Sahay writes it as a need: rice, 50 kg, by Friday.",
    hi: "उदाहरण: मालिक कहते हैं पचास किलो चावल, शुक्रवार तक, और सहाय इसे ज़रूरत के रूप में लिखता है: चावल, 50 किलो, शुक्रवार तक।",
    kn: "ಉದಾಹರಣೆ: ಮಾಲೀಕರು ಐವತ್ತು ಕಿಲೋ ಅಕ್ಕಿ ಶುಕ್ರವಾರದೊಳಗೆ ಎನ್ನುತ್ತಾರೆ, ಸಹಾಯ್ ಅದನ್ನು ಅಗತ್ಯವಾಗಿ ಬರೆಯುತ್ತದೆ: ಅಕ್ಕಿ, 50 ಕಿಲೋ, ಶುಕ್ರವಾರದೊಳಗೆ.",
  },

  findTitle: { en: "Sahay finds real sellers", hi: "सहाय असली विक्रेता ढूँढता है", kn: "ಸಹಾಯ್ ನಿಜವಾದ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ" },
  findBody: {
    en: "Sellers who serve your city, from IndiaMART listings.",
    hi: "आपके शहर तक माल देने वाले विक्रेता, IndiaMART की सूची से।",
    kn: "ನಿಮ್ಮ ನಗರಕ್ಕೆ ಮಾಲು ಕೊಡುವ ಮಾರಾಟಗಾರರು, IndiaMART ಪಟ್ಟಿಯಿಂದ.",
  },
  bengaluru: { en: "Bengaluru", hi: "बेंगलुरु", kn: "ಬೆಂಗಳೂರು" },
  yourShop: { en: "Your shop", hi: "आपकी दुकान", kn: "ನಿಮ್ಮ ಅಂಗಡಿ" },
  km4: { en: "4 km", hi: "4 किमी", kn: "4 ಕಿಮೀ" },
  km6: { en: "6 km", hi: "6 किमी", kn: "6 ಕಿಮೀ" },
  km9: { en: "9 km", hi: "9 किमी", kn: "9 ಕಿಮೀ" },
  findAlt: {
    en: "Example: three invented sellers around Bengaluru, 4, 6 and 9 kilometres from your shop.",
    hi: "उदाहरण: बेंगलुरु में तीन काल्पनिक विक्रेता, आपकी दुकान से 4, 6 और 9 किलोमीटर दूर।",
    kn: "ಉದಾಹರಣೆ: ಬೆಂಗಳೂರಿನಲ್ಲಿ ಮೂವರು ಕಾಲ್ಪನಿಕ ಮಾರಾಟಗಾರರು, ನಿಮ್ಮ ಅಂಗಡಿಯಿಂದ 4, 6 ಮತ್ತು 9 ಕಿಲೋಮೀಟರ್ ದೂರ.",
  },

  bargainTitle: { en: "Sahay bargains for you", hi: "सहाय आपके लिए मोलभाव करता है", kn: "ಸಹಾಯ್ ನಿಮಗಾಗಿ ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ" },
  bargainBody: {
    en: "It talks to the seller, says first that it is an automated assistant, and brings the price down.",
    hi: "वह विक्रेता से बात करता है, पहले बताता है कि वह स्वचालित सहायक है, और दाम कम करवाता है।",
    kn: "ಅದು ಮಾರಾಟಗಾರರ ಜೊತೆ ಮಾತನಾಡುತ್ತದೆ, ತಾನು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ ಎಂದು ಮೊದಲೇ ಹೇಳುತ್ತದೆ, ಬೆಲೆ ಇಳಿಸುತ್ತದೆ.",
  },
  disclose: {
    en: "“Hello, I am Sahay, an automated assistant for Mango Tree Kirana.”",
    hi: "“नमस्ते, मैं सहाय हूँ, Mango Tree Kirana का स्वचालित सहायक।”",
    kn: "“ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, Mango Tree Kirana ಅಂಗಡಿಯ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ.”",
  },
  deal: { en: "Deal", hi: "सौदा", kn: "ಒಪ್ಪಂದ" },
  sellerAsks: { en: "Seller asks", hi: "विक्रेता का दाम", kn: "ಮಾರಾಟಗಾರರ ಬೆಲೆ" },
  sahayOffers: { en: "Sahay offers", hi: "सहाय का दाम", kn: "ಸಹಾಯ್ ಬೆಲೆ" },
  bargainAlt: {
    en: "Example: Sahay first says it is an automated assistant. The seller asks 65 rupees a kilo and Sahay offers 45; then 60 against 50; they meet at 55 rupees a kilo, shown as a balance whose beam levels when the two prices are equal.",
    hi: "उदाहरण: सहाय पहले बताता है कि वह स्वचालित सहायक है। विक्रेता 65 रुपये किलो माँगता है, सहाय 45 कहता है; फिर 60 और 50; सौदा 55 रुपये किलो पर तय होता है। तराज़ू की डंडी तभी सीधी होती है जब दोनों दाम बराबर हों।",
    kn: "ಉದಾಹರಣೆ: ಸಹಾಯ್ ಮೊದಲು ತಾನು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ ಎನ್ನುತ್ತದೆ. ಮಾರಾಟಗಾರರು ಕಿಲೋಗೆ 65 ರೂಪಾಯಿ ಕೇಳುತ್ತಾರೆ, ಸಹಾಯ್ 45 ಎನ್ನುತ್ತದೆ; ನಂತರ 60 ಮತ್ತು 50; ಕಿಲೋಗೆ 55 ರೂಪಾಯಿಗೆ ಒಪ್ಪಂದ. ಎರಡು ಬೆಲೆ ಸಮವಾದಾಗ ಮಾತ್ರ ತಕ್ಕಡಿಯ ದಂಡ ಸಮವಾಗುತ್ತದೆ.",
  },


  yesTitle: { en: "Nothing happens without your yes", hi: "आपकी हाँ के बिना कुछ नहीं होता", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ಆಗುವುದಿಲ್ಲ" },
  yesBody: {
    en: "Sahay reads the deal out loud. You say yes, or tap the tick. Only then it orders.",
    hi: "सहाय सौदा पढ़कर सुनाता है। आप हाँ कहें या हाँ का बटन दबाएँ। तभी ऑर्डर होता है।",
    kn: "ಸಹಾಯ್ ಒಪ್ಪಂದವನ್ನು ಓದಿ ಹೇಳುತ್ತದೆ. ನೀವು ಹೌದು ಎನ್ನಿ ಅಥವಾ ಹೌದು ಗುಂಡಿ ಒತ್ತಿ. ಆಮೇಲೆ ಮಾತ್ರ ಆರ್ಡರ್.",
  },
  perKg: { en: "/kg", hi: "/किलो", kn: "/ಕಿಲೋ" },
  kg: { en: "kg", hi: "किलो", kn: "ಕಿಲೋ" },
  yes: { en: "Yes", hi: "हाँ", kn: "ಹೌದು" },
  no: { en: "No", hi: "नहीं", kn: "ಬೇಡ" },
  ordered: { en: "Ordered after your yes", hi: "आपकी हाँ के बाद ऑर्डर हुआ", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ ಆರ್ಡರ್ ಆಯಿತು" },
  yesAlt: {
    en: "Example: a yes card for Kite Hill Grains, 55 rupees a kilo times 50 kilos equals 2,750 rupees, with a yes and a no button. The order is placed only after yes.",
    hi: "उदाहरण: Kite Hill Grains के लिए हाँ वाला कार्ड, 55 रुपये किलो गुणा 50 किलो बराबर 2,750 रुपये, हाँ और नहीं के बटन के साथ। ऑर्डर सिर्फ़ हाँ के बाद होता है।",
    kn: "ಉದಾಹರಣೆ: Kite Hill Grains ಗಾಗಿ ಒಪ್ಪಿಗೆ ಕಾರ್ಡ್, ಕಿಲೋಗೆ 55 ರೂಪಾಯಿ ಗುಣಿಸು 50 ಕಿಲೋ ಸಮ 2,750 ರೂಪಾಯಿ, ಹೌದು ಮತ್ತು ಬೇಡ ಗುಂಡಿಗಳ ಜೊತೆ. ಹೌದು ಎಂದ ನಂತರ ಮಾತ್ರ ಆರ್ಡರ್.",
  },

  sellTitle: { en: "It writes the bill after your yes", hi: "आपकी हाँ के बाद बिल बनाता है", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ ಬಿಲ್ ಬರೆಯುತ್ತದೆ" },
  sellBody: {
    en: "Say who bought what. Sahay reads the bill back, makes it only after your yes, and keeps your khata of who owes you.",
    hi: "किसने क्या ख़रीदा, बताइए। सहाय बिल पढ़कर सुनाता है, आपकी हाँ के बाद ही बनाता है, और खाते में लिखता है कि किसका कितना बाक़ी है।",
    kn: "ಯಾರು ಏನು ಕೊಂಡರು ಎಂದು ಹೇಳಿ. ಸಹಾಯ್ ಬಿಲ್ ಓದಿ ಹೇಳುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ ಮಾಡುತ್ತದೆ, ಯಾರು ಎಷ್ಟು ಬಾಕಿ ಎಂದು ಖಾತೆಯಲ್ಲಿ ಬರೆಯುತ್ತದೆ.",
  },
  sellPoint1: { en: "GST bill as a PDF, ready to share", hi: "GST बिल PDF में, भेजने के लिए तैयार", kn: "GST ಬಿಲ್ PDF ಆಗಿ, ಕಳುಹಿಸಲು ಸಿದ್ಧ" },
  sellPoint2: { en: "Khata: who owes you, with a polite reminder", hi: "खाता: किसका बाक़ी है, और विनम्र याद-दिहानी", kn: "ಖಾತೆ: ಯಾರು ಬಾಕಿ ಇದ್ದಾರೆ, ಜೊತೆಗೆ ಸೌಮ್ಯ ನೆನಪು" },

  stockTitle: { en: "When stock runs low, it offers to buy again", hi: "स्टॉक कम हो तो फिर से ख़रीदने को पूछता है", kn: "ದಾಸ್ತಾನು ಕಡಿಮೆಯಾದಾಗ ಮತ್ತೆ ಕೊಳ್ಳಲು ಕೇಳುತ್ತದೆ" },
  stockBody: {
    en: "Every bill takes stock out. Below your level, Sahay asks before it starts buying.",
    hi: "हर बिल से स्टॉक घटता है। आपकी तय सीमा से नीचे जाते ही सहाय ख़रीद शुरू करने से पहले पूछता है।",
    kn: "ಪ್ರತಿ ಬಿಲ್ ದಾಸ್ತಾನು ಕಡಿಮೆ ಮಾಡುತ್ತದೆ. ನೀವು ಇಟ್ಟ ಮಿತಿಗಿಂತ ಕೆಳಗೆ ಹೋದರೆ, ಖರೀದಿ ಶುರು ಮಾಡುವ ಮೊದಲು ಸಹಾಯ್ ಕೇಳುತ್ತದೆ.",
  },
  kg8: { en: "8 kg", hi: "8 किलो", kn: "8 ಕಿಲೋ" },
  nodeSell: { en: "Sold", hi: "बिका", kn: "ಮಾರಾಟ" },
  stockSold: { en: "12 kg rice on a bill", hi: "एक बिल पर 12 किलो चावल", kn: "ಒಂದು ಬಿಲ್‌ನಲ್ಲಿ 12 ಕಿಲೋ ಅಕ್ಕಿ" },
  nodeLow: { en: "Stock low", hi: "स्टॉक कम", kn: "ದಾಸ್ತಾನು ಕಡಿಮೆ" },
  stockLow: { en: "8 kg left, your level is 10", hi: "8 किलो बचा, आपकी सीमा 10", kn: "8 ಕಿಲೋ ಉಳಿದಿದೆ, ನಿಮ್ಮ ಮಿತಿ 10" },
  nodeBuy: { en: "Buy again?", hi: "फिर ख़रीदें?", kn: "ಮತ್ತೆ ಕೊಳ್ಳಬೇಕೇ?" },
  stockAsk: { en: "Sahay asks: 50 kg again?", hi: "सहाय पूछता है: फिर 50 किलो?", kn: "ಸಹಾಯ್ ಕೇಳುತ್ತದೆ: ಮತ್ತೆ 50 ಕಿಲೋ?" },
  stockAlt: {
    en: "Example: a bill sells 12 kilos of rice, stock falls to 8 kilos, below the owner's level of 10, and Sahay asks whether to buy 50 kilos again. Nothing is bought until the owner says yes.",
    hi: "उदाहरण: एक बिल पर 12 किलो चावल बिकता है, स्टॉक 8 किलो रह जाता है, जो मालिक की सीमा 10 से कम है, और सहाय पूछता है कि क्या फिर से 50 किलो ख़रीदें। मालिक की हाँ के बिना कुछ नहीं ख़रीदा जाता।",
    kn: "ಉದಾಹರಣೆ: ಒಂದು ಬಿಲ್‌ನಲ್ಲಿ 12 ಕಿಲೋ ಅಕ್ಕಿ ಮಾರಾಟವಾಗುತ್ತದೆ, ದಾಸ್ತಾನು 8 ಕಿಲೋಗೆ ಇಳಿಯುತ್ತದೆ, ಅದು ಮಾಲೀಕರ ಮಿತಿ 10ಕ್ಕಿಂತ ಕಡಿಮೆ, ಸಹಾಯ್ ಮತ್ತೆ 50 ಕಿಲೋ ಕೊಳ್ಳಲೇ ಎಂದು ಕೇಳುತ್ತದೆ. ಮಾಲೀಕರ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ಕೊಳ್ಳುವುದಿಲ್ಲ.",
  },

  learnTitle: { en: "Your Sahay learns you", hi: "आपका सहाय आपको समझता है", kn: "ನಿಮ್ಮ ಸಹಾಯ್ ನಿಮ್ಮನ್ನು ಅರಿಯುತ್ತದೆ" },
  learnBody: {
    en: "Teach it by talking. It keeps your rules and shows you why.",
    hi: "बात करके सिखाइए। वह आपके नियम याद रखता है और कारण भी बताता है।",
    kn: "ಮಾತನಾಡಿ ಕಲಿಸಿ. ಅದು ನಿಮ್ಮ ನಿಯಮಗಳನ್ನು ನೆನಪಿಡುತ್ತದೆ, ಕಾರಣವನ್ನೂ ತೋರಿಸುತ್ತದೆ.",
  },
  ruleRice: { en: "Rice: never above ₹56", hi: "चावल: ₹56 से ज़्यादा नहीं", kn: "ಅಕ್ಕಿ: ₹56ಕ್ಕಿಂತ ಹೆಚ್ಚು ಬೇಡ" },
  usual50: { en: "Usually 50 kg", hi: "अक्सर 50 किलो", kn: "ಸಾಮಾನ್ಯವಾಗಿ 50 ಕಿಲೋ" },
  likes: { en: "Likes", hi: "पसंद:", kn: "ಇಷ್ಟ:" },
  gentle: { en: "Bargains gently", hi: "नरमी से मोलभाव", kn: "ಮೃದುವಾಗಿ ಚೌಕಾಸಿ" },
  keepRule: { en: "Keep this rule?", hi: "यह नियम रखूँ?", kn: "ಈ ನಿಯಮ ಇಡಲೇ?" },
  learnAlt: {
    en: "Example: Sahay remembers that rice is never bought above 56 rupees, the usual 50 kilos, a liked seller and a gentle bargaining style, and asks before keeping a new rule.",
    hi: "उदाहरण: सहाय याद रखता है कि चावल 56 रुपये से ज़्यादा में नहीं, अक्सर 50 किलो, एक पसंदीदा विक्रेता और नरम मोलभाव, और नया नियम रखने से पहले पूछता है।",
    kn: "ಉದಾಹರಣೆ: ಅಕ್ಕಿ 56 ರೂಪಾಯಿಗಿಂತ ಹೆಚ್ಚಿಗೆ ಬೇಡ, ಸಾಮಾನ್ಯವಾಗಿ 50 ಕಿಲೋ, ಇಷ್ಟದ ಮಾರಾಟಗಾರ, ಮೃದು ಚೌಕಾಸಿ ಎಂದು ಸಹಾಯ್ ನೆನಪಿಡುತ್ತದೆ, ಹೊಸ ನಿಯಮ ಇಡುವ ಮೊದಲು ಕೇಳುತ್ತದೆ.",
  },

  finaleTitle: {
    en: "Speak in your language. Sahay does the running around.",
    hi: "अपनी भाषा में बोलिए। भाग-दौड़ सहाय करेगा।",
    kn: "ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ. ಓಡಾಟ ಸಹಾಯ್ ಮಾಡುತ್ತದೆ.",
  },
  creditAgora: { en: "Live voice call", hi: "लाइव आवाज़ कॉल", kn: "ನೇರ ಧ್ವನಿ ಕರೆ" },
  creditSarvam: { en: "Hears Hindi, Kannada, English", hi: "हिंदी, कन्नड़, अंग्रेज़ी सुनता है", kn: "ಹಿಂದಿ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಕೇಳುತ್ತದೆ" },
  creditMurf: { en: "Speaks back in your language", hi: "आपकी भाषा में जवाब देता है", kn: "ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲೇ ಉತ್ತರಿಸುತ್ತದೆ" },

  footNotice: {
    en: "Sahay is an automated assistant. It never orders or pays without your yes.",
    hi: "सहाय एक स्वचालित सहायक है। आपकी हाँ के बिना वह न ऑर्डर करता है, न भुगतान।",
    kn: "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಆರ್ಡರ್ ಅಥವಾ ಪಾವತಿ ಮಾಡುವುದಿಲ್ಲ.",
  },
  footTest: {
    en: "Payments run in Razorpay test mode. Pictures on this page are examples with made-up names.",
    hi: "भुगतान Razorpay के टेस्ट मोड में चलते हैं। इस पेज की तस्वीरें काल्पनिक नामों वाले उदाहरण हैं।",
    kn: "ಪಾವತಿಗಳು Razorpay ಪರೀಕ್ಷಾ ಮೋಡ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತವೆ. ಈ ಪುಟದ ಚಿತ್ರಗಳು ಕಾಲ್ಪನಿಕ ಹೆಸರುಗಳ ಉದಾಹರಣೆಗಳು.",
  },
};

export function t(key, lang) {
  const entry = S[key];
  return entry ? entry[lang] ?? entry.en : "";
}

/** Rewrites every [data-i18n] text and [data-i18n-attr="attr:key"] attribute, and the page lang. */
export function applyLanguage(lang) {
  const root = document.documentElement;
  root.lang = lang;
  root.dataset.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const text = t(el.dataset.i18n, lang);
    if (text) el.textContent = text;
  }
  for (const el of document.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(",")) {
      const [attr, key] = pair.split(":");
      const text = t(key, lang);
      if (text) el.setAttribute(attr, text);
    }
  }
  for (const btn of document.querySelectorAll("button[data-lang]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
  }
}
