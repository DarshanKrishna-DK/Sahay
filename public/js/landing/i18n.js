// Landing page words in English, Hindi (Devanagari) and Kannada (Kannada script).
// Every picture on the page is an example (each one carries an "Example" tag); names like
// "seller 01" are placeholders, never real businesses.

export const LANGS = ["hi", "kn", "en"];

const S = {
  skip: { en: "Skip to content", hi: "सीधे मुख्य भाग पर जाएँ", kn: "ಮುಖ್ಯ ಭಾಗಕ್ಕೆ ಹೋಗಿ" },
  brandTop: { en: "Sahay, back to top", hi: "सहाय, ऊपर जाएँ", kn: "ಸಹಾಯ್, ಮೇಲಕ್ಕೆ ಹೋಗಿ" },
  aiChip: { en: "Automated assistant", hi: "स्वचालित सहायक", kn: "ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ" },
  navLabel: { en: "Page", hi: "पेज", kn: "ಪುಟ" },
  navHow: { en: "How it works", hi: "कैसे चलता है", kn: "ಹೇಗೆ ನಡೆಯುತ್ತದೆ" },
  navBuilt: { en: "Built on", hi: "किस पर बना", kn: "ಯಾವುದರ ಮೇಲೆ" },
  langChoose: { en: "Choose your language", hi: "अपनी भाषा चुनें", kn: "ನಿಮ್ಮ ಭಾಷೆ ಆರಿಸಿ" },
  // "Language: <name>" on the switcher (the name is always in its own script).
  langCurrent: { en: "Language: {name}", hi: "भाषा: {name}", kn: "ಭಾಷೆ: {name}" },
  // Kept for the shared theme contract (the landing itself is dark only).
  toLight: { en: "Switch to light", hi: "हल्का रंग", kn: "ತಿಳಿ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  toDark: { en: "Switch to dark", hi: "गहरा रंग", kn: "ಗಾಢ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  start: { en: "Start talking", hi: "बोलकर शुरू करें", kn: "ಮಾತನಾಡಿ ಶುರು ಮಾಡಿ" },
  openSahay: { en: "Open Sahay", hi: "सहाय खोलें", kn: "ಸಹಾಯ್ ತೆರೆಯಿರಿ" },
  open: { en: "Open", hi: "खोलें", kn: "ತೆರೆಯಿರಿ" },
  example: { en: "Example", hi: "उदाहरण", kn: "ಉದಾಹರಣೆ" },

  // The hero headline in three lines (the first white, the next two lit).
  heroL1: { en: "Your shop's assistant.", hi: "आपकी दुकान का सहायक।", kn: "ನಿಮ್ಮ ಅಂಗಡಿಯ ಸಹಾಯಕ." },
  heroL2: { en: "It bargains and bills,", hi: "मोलभाव और बिल यह करे,", kn: "ಚೌಕಾಸಿ, ಬಿಲ್ ಅದರ ಕೆಲಸ," },
  heroL3: { en: "you say yes.", hi: "हाँ आप कहें।", kn: "ಒಪ್ಪಿಗೆ ನಿಮ್ಮದು." },
  heroSub: {
    en: "Say what you need in Hindi, Kannada or English, and Sahay finds sellers, bargains, makes bills and tracks stock while you mind the counter.",
    hi: "हिन्दी, कन्नड़ या अंग्रेज़ी में बताइए क्या चाहिए, और जब तक आप काउंटर सँभालते हैं, सहाय विक्रेता ढूँढता है, मोलभाव करता है, बिल बनाता है और स्टॉक पर नज़र रखता है।",
    kn: "ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ; ನೀವು ಕೌಂಟರ್ ನೋಡಿಕೊಳ್ಳುವಾಗ ಸಹಾಯ್ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ, ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ, ಬಿಲ್ ಮಾಡುತ್ತದೆ, ದಾಸ್ತಾನು ನೋಡಿಕೊಳ್ಳುತ್ತದೆ.",
  },
  heroMore: { en: "See how it works", hi: "देखिए कैसे चलता है", kn: "ಹೇಗೆ ನಡೆಯುತ್ತದೆ ನೋಡಿ" },
  heroAlt: {
    en: "Example picture: points of light gather into Sahay's orb and a rupee sign. Labels mark the story: seller 01 comes down from 65 to 55 rupees a kilo, rice stock is 35 kilos, the order waits for your yes, and Sahay speaks Hindi, Kannada and English.",
    hi: "उदाहरण चित्र: रोशनी के बिंदु जुड़कर सहाय का गोला और रुपये का चिह्न बनाते हैं। निशान कहानी बताते हैं: विक्रेता 01 पैंसठ से पचपन रुपये किलो पर आता है, चावल का स्टॉक पैंतीस किलो है, ऑर्डर आपकी हाँ का इंतज़ार करता है, और सहाय हिन्दी, कन्नड़ और अंग्रेज़ी बोलता है।",
    kn: "ಉದಾಹರಣೆ ಚಿತ್ರ: ಬೆಳಕಿನ ಚುಕ್ಕೆಗಳು ಸೇರಿ ಸಹಾಯ್‌ನ ಗೋಳ ಮತ್ತು ರೂಪಾಯಿ ಚಿಹ್ನೆ ಆಗುತ್ತವೆ. ಗುರುತುಗಳು ಕಥೆ ಹೇಳುತ್ತವೆ: ಮಾರಾಟಗಾರ 01 ಕಿಲೋಗೆ ಅರವತ್ತೈದರಿಂದ ಐವತ್ತೈದು ರೂಪಾಯಿಗೆ ಇಳಿಯುತ್ತಾರೆ, ಅಕ್ಕಿ ದಾಸ್ತಾನು ಮೂವತ್ತೈದು ಕಿಲೋ, ಆರ್ಡರ್ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತದೆ, ಸಹಾಯ್ ಹಿಂದಿ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಮಾತನಾಡುತ್ತದೆ.",
  },
  hudSeller: { en: "seller 01", hi: "विक्रेता 01", kn: "ಮಾರಾಟಗಾರ 01" },
  hudStock: { en: "stock, rice", hi: "स्टॉक, चावल", kn: "ದಾಸ್ತಾನು, ಅಕ್ಕಿ" },
  hudOrder: { en: "order", hi: "ऑर्डर", kn: "ಆರ್ಡರ್" },
  hudWaits: { en: "waits for your yes", hi: "आपकी हाँ का इंतज़ार", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ" },
  hudSpeaks: { en: "speaks", hi: "बोलता है", kn: "ಮಾತನಾಡುತ್ತದೆ" },

  howEyebrow: { en: "Voice first", hi: "आवाज़ से", kn: "ಧ್ವನಿಯಿಂದ" },
  howTitle: {
    en: "How Sahay buys for your shop in three steps",
    hi: "सहाय तीन क़दम में आपकी दुकान के लिए कैसे ख़रीदता है",
    kn: "ಸಹಾಯ್ ಮೂರು ಹಂತಗಳಲ್ಲಿ ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಹೇಗೆ ಖರೀದಿಸುತ್ತದೆ",
  },
  howSub: {
    en: "Keep serving customers at the counter. Sahay makes the calls, bargains, and waits for your yes.",
    hi: "आप काउंटर पर ग्राहक सँभालिए। फ़ोन, मोलभाव सहाय करता है, और आपकी हाँ का इंतज़ार करता है।",
    kn: "ನೀವು ಕೌಂಟರ್‌ನಲ್ಲಿ ಗ್ರಾಹಕರನ್ನು ನೋಡಿಕೊಳ್ಳಿ. ಕರೆ, ಚೌಕಾಸಿ ಸಹಾಯ್ ಮಾಡುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತದೆ.",
  },
  step1Title: { en: "Say what you need", hi: "बताइए क्या चाहिए", kn: "ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ" },
  step1Copy: {
    en: "Speak the way you talk to a supplier. No menus, no item codes.",
    hi: "वैसे ही बोलिए जैसे सप्लायर से बोलते हैं। न मेन्यू, न आइटम कोड।",
    kn: "ಸರಬರಾಜುದಾರರ ಜೊತೆ ಮಾತನಾಡುವ ಹಾಗೆಯೇ ಹೇಳಿ. ಮೆನು ಇಲ್ಲ, ಐಟಂ ಕೋಡ್ ಇಲ್ಲ.",
  },
  step2Title: { en: "Sahay bargains with sellers", hi: "सहाय विक्रेताओं से मोलभाव करता है", kn: "ಸಹಾಯ್ ಮಾರಾಟಗಾರರ ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ" },
  step2Copy: {
    en: "It calls real sellers near you, says it is an automated assistant, and brings the price down.",
    hi: "यह आपके पास के असली विक्रेताओं से बात करता है, बताता है कि यह स्वचालित सहायक है, और दाम कम कराता है।",
    kn: "ಇದು ನಿಮ್ಮ ಹತ್ತಿರದ ನಿಜ ಮಾರಾಟಗಾರರಿಗೆ ಕರೆ ಮಾಡಿ, ತಾನು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ ಎಂದು ಹೇಳಿ, ಬೆಲೆ ಇಳಿಸುತ್ತದೆ.",
  },
  step3Title: { en: "You say yes", hi: "आप हाँ कहते हैं", kn: "ನೀವು ಒಪ್ಪಿಗೆ ಕೊಡುತ್ತೀರಿ" },
  step3Copy: {
    en: "Sahay reads the deal out loud. Say yes or tap Yes; only then does it order.",
    hi: "सहाय सौदा पढ़कर सुनाता है। हाँ कहें या हाँ दबाएँ; तभी ऑर्डर जाता है।",
    kn: "ಸಹಾಯ್ ವ್ಯವಹಾರವನ್ನು ಓದಿ ಹೇಳುತ್ತದೆ. ಹೌದು ಎನ್ನಿ ಅಥವಾ ಹೌದು ಒತ್ತಿ; ಆಗ ಮಾತ್ರ ಆರ್ಡರ್ ಹೋಗುತ್ತದೆ.",
  },
  panelVoice: { en: "You said", hi: "आपने कहा", kn: "ನೀವು ಹೇಳಿದ್ದು" },
  byFriday: { en: "By Friday", hi: "शुक्रवार तक", kn: "ಶುಕ್ರವಾರದೊಳಗೆ" },
  sellerAsked: { en: "Seller asked", hi: "विक्रेता ने माँगा", kn: "ಮಾರಾಟಗಾರರು ಕೇಳಿದ್ದು" },
  sahayOffered: { en: "Sahay offered", hi: "सहाय ने कहा", kn: "ಸಹಾಯ್ ಕೊಟ್ಟ ಬೆಲೆ" },
  agreed: { en: "Agreed", hi: "तय हुआ", kn: "ಒಪ್ಪಿದ ಬೆಲೆ" },
  yesOrder: { en: "Yes, order it", hi: "हाँ, ऑर्डर करें", kn: "ಹೌದು, ಆರ್ಡರ್ ಮಾಡಿ" },
  howAlt: {
    en: "Examples: you say fifty kilos of rice by Friday; seller 01 asks 65 rupees a kilo, Sahay offers 50, they agree at 55; you say yes to 50 kilos at 55 rupees, 2,750 rupees in all.",
    hi: "उदाहरण: आप कहते हैं शुक्रवार तक पचास किलो चावल; विक्रेता 01 पैंसठ रुपये किलो माँगता है, सहाय पचास कहता है, पचपन पर तय होता है; आप पचपन रुपये पर 50 किलो, कुल दो हज़ार सात सौ पचास रुपये, को हाँ कहते हैं।",
    kn: "ಉದಾಹರಣೆಗಳು: ಶುಕ್ರವಾರದೊಳಗೆ ಐವತ್ತು ಕಿಲೋ ಅಕ್ಕಿ ಎನ್ನುತ್ತೀರಿ; ಮಾರಾಟಗಾರ 01 ಕಿಲೋಗೆ ಅರವತ್ತೈದು ಕೇಳುತ್ತಾರೆ, ಸಹಾಯ್ ಐವತ್ತು ಹೇಳುತ್ತದೆ, ಐವತ್ತೈದಕ್ಕೆ ಒಪ್ಪಿಗೆ; ಐವತ್ತೈದು ರೂಪಾಯಿಯಂತೆ 50 ಕೆಜಿ, ಒಟ್ಟು ಎರಡು ಸಾವಿರದ ಏಳುನೂರ ಐವತ್ತು ರೂಪಾಯಿಗೆ ನೀವು ಹೌದು ಎನ್ನುತ್ತೀರಿ.",
  },
  storyTitle: {
    en: "The whole loop, step by step",
    hi: "पूरा चक्र, क़दम-दर-क़दम",
    kn: "ಇಡೀ ಚಕ್ರ, ಹಂತ ಹಂತವಾಗಿ",
  },
  storyIntro: {
    en: "Eight steps. Sahay does the running around; you say what you need, and you say yes.",
    hi: "आठ क़दम। भागदौड़ सहाय करता है; आप बस बताते हैं क्या चाहिए, और हाँ कहते हैं।",
    kn: "ಎಂಟು ಹಂತಗಳು. ಓಡಾಟ ಸಹಾಯ್‌ದು; ನೀವು ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ, ಒಪ್ಪಿಗೆ ಕೊಡಿ ಸಾಕು.",
  },
  railLabel: { en: "Steps", hi: "क़दम", kn: "ಹಂತಗಳು" },
  s1: { en: "Speak", hi: "बोलिए", kn: "ಮಾತನಾಡಿ" },
  s2: { en: "Real sellers", hi: "असली विक्रेता", kn: "ನಿಜ ಮಾರಾಟಗಾರರು" },
  s3: { en: "Bargaining", hi: "मोलभाव", kn: "ಚೌಕಾಸಿ" },
  s4: { en: "Your yes", hi: "आपकी हाँ", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ" },
  s5: { en: "Sell and khata", hi: "बिक्री और खाता", kn: "ಮಾರಾಟ ಮತ್ತು ಖಾತೆ" },
  s6: { en: "Stock low", hi: "स्टॉक कम", kn: "ದಾಸ್ತಾನು ಕಡಿಮೆ" },
  s7: { en: "Buy again", hi: "फिर से ख़रीदें", kn: "ಮತ್ತೆ ಖರೀದಿ" },
  s8: { en: "Languages", hi: "भाषाएँ", kn: "ಭಾಷೆಗಳು" },

  c1Title: { en: "Say it the way you say it", hi: "जैसे आप बोलते हैं, वैसे बोलिए", kn: "ನೀವು ಮಾತನಾಡುವ ಹಾಗೆಯೇ ಹೇಳಿ" },
  c1Body: {
    en: "Talk in Hindi, Kannada or English, or mix them. Sahay writes your words down as a clear need.",
    hi: "हिन्दी, कन्नड़ या अंग्रेज़ी में बोलिए, या मिलाकर। सहाय आपकी बात को साफ़ ज़रूरत की तरह लिख लेता है।",
    kn: "ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತನಾಡಿ, ಬೆರೆಸಿಯೂ ಆಗಬಹುದು. ಸಹಾಯ್ ನಿಮ್ಮ ಮಾತನ್ನು ಸ್ಪಷ್ಟ ಅಗತ್ಯವಾಗಿ ಬರೆದುಕೊಳ್ಳುತ್ತದೆ.",
  },
  quote1: { en: "“Fifty kilos of rice, by Friday.”", hi: "“पचास किलो चावल, शुक्रवार तक।”", kn: "“ಐವತ್ತು ಕಿಲೋ ಅಕ್ಕಿ, ಶುಕ್ರವಾರದೊಳಗೆ.”" },
  needWhat: { en: "What", hi: "क्या", kn: "ಏನು" },
  needQty: { en: "How much", hi: "कितना", kn: "ಎಷ್ಟು" },
  needBy: { en: "By", hi: "कब तक", kn: "ಯಾವಾಗದೊಳಗೆ" },
  rice: { en: "Rice", hi: "चावल", kn: "ಅಕ್ಕಿ" },
  kg50: { en: "50 kg", hi: "50 किलो", kn: "50 ಕೆಜಿ" },
  kg35: { en: "35 kg", hi: "35 किलो", kn: "35 ಕೆಜಿ" },
  kg12: { en: "12 kg", hi: "12 किलो", kn: "12 ಕೆಜಿ" },
  perKg: { en: "/kg", hi: "/किलो", kn: "/ಕೆಜಿ" },
  friday: { en: "Friday", hi: "शुक्रवार", kn: "ಶುಕ್ರವಾರ" },
  c1Alt: {
    en: "Example: the owner says fifty kilos of rice by Friday; Sahay writes the need as rice, 50 kilos, by Friday.",
    hi: "उदाहरण: मालिक कहते हैं शुक्रवार तक पचास किलो चावल; सहाय ज़रूरत लिखता है: चावल, 50 किलो, शुक्रवार तक।",
    kn: "ಉದಾಹರಣೆ: ಮಾಲೀಕರು ಶುಕ್ರವಾರದೊಳಗೆ ಐವತ್ತು ಕಿಲೋ ಅಕ್ಕಿ ಎನ್ನುತ್ತಾರೆ; ಸಹಾಯ್ ಅಗತ್ಯವನ್ನು ಅಕ್ಕಿ, 50 ಕೆಜಿ, ಶುಕ್ರವಾರದೊಳಗೆ ಎಂದು ಬರೆಯುತ್ತದೆ.",
  },

  c2Title: { en: "Sahay finds real sellers near you", hi: "सहाय आपके पास के असली विक्रेता ढूँढता है", kn: "ಸಹಾಯ್ ನಿಮ್ಮ ಹತ್ತಿರದ ನಿಜ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ" },
  c2Body: {
    en: "Sellers who serve your city, from IndiaMART listings. If a source is down, Sahay says so; it never makes sellers up.",
    hi: "आपके शहर में माल देने वाले विक्रेता, IndiaMART की सूची से। कोई स्रोत बंद हो तो सहाय साफ़ बताता है; वह विक्रेता कभी गढ़ता नहीं।",
    kn: "ನಿಮ್ಮ ನಗರಕ್ಕೆ ಮಾಲು ಕೊಡುವ ಮಾರಾಟಗಾರರು, IndiaMART ಪಟ್ಟಿಯಿಂದ. ಮೂಲ ಕೆಲಸ ಮಾಡದಿದ್ದರೆ ಸಹಾಯ್ ಹಾಗೆಯೇ ಹೇಳುತ್ತದೆ; ಮಾರಾಟಗಾರರನ್ನು ಕಲ್ಪಿಸುವುದಿಲ್ಲ.",
  },
  yourShop: { en: "Your shop", hi: "आपकी दुकान", kn: "ನಿಮ್ಮ ಅಂಗಡಿ" },
  seller01: { en: "seller 01", hi: "विक्रेता 01", kn: "ಮಾರಾಟಗಾರ 01" },
  seller02: { en: "seller 02", hi: "विक्रेता 02", kn: "ಮಾರಾಟಗಾರ 02" },
  seller03: { en: "seller 03", hi: "विक्रेता 03", kn: "ಮಾರಾಟಗಾರ 03" },
  km4: { en: "4 km", hi: "4 किमी", kn: "4 ಕಿಮೀ" },
  km6: { en: "6 km", hi: "6 किमी", kn: "6 ಕಿಮೀ" },
  km9: { en: "9 km", hi: "9 किमी", kn: "9 ಕಿಮೀ" },
  c2Alt: {
    en: "Example: three sellers around your shop, 4, 6 and 9 kilometres away.",
    hi: "उदाहरण: आपकी दुकान के आसपास तीन विक्रेता, 4, 6 और 9 किलोमीटर दूर।",
    kn: "ಉದಾಹರಣೆ: ನಿಮ್ಮ ಅಂಗಡಿಯ ಸುತ್ತ ಮೂವರು ಮಾರಾಟಗಾರರು, 4, 6 ಮತ್ತು 9 ಕಿಲೋಮೀಟರ್ ದೂರ.",
  },

  c3Title: { en: "It bargains, and says who it is", hi: "मोलभाव करता है, और बताता है कि वह कौन है", kn: "ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ, ತಾನು ಯಾರು ಎಂದು ಹೇಳುತ್ತದೆ" },
  c3Body: {
    en: "The first sentence of every call says Sahay is an automated assistant. Then it brings the price down, round by round.",
    hi: "हर कॉल का पहला वाक्य बताता है कि सहाय एक स्वचालित सहायक है। फिर वह दौर-दर-दौर दाम कम कराता है।",
    kn: "ಪ್ರತಿ ಕರೆಯ ಮೊದಲ ವಾಕ್ಯವೇ ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ ಎಂದು ಹೇಳುತ್ತದೆ. ನಂತರ ಸುತ್ತು ಸುತ್ತಾಗಿ ಬೆಲೆ ಇಳಿಸುತ್ತದೆ.",
  },
  disclose: {
    en: "“Namaste, I am Sahay, an automated assistant for your shop.”",
    hi: "“नमस्ते, मैं सहाय हूँ, आपकी दुकान का स्वचालित सहायक।”",
    kn: "“ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, ನಿಮ್ಮ ಅಂಗಡಿಯ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ.”",
  },

  c4Title: { en: "Nothing is ordered without your yes", hi: "आपकी हाँ के बिना कोई ऑर्डर नहीं", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಇಲ್ಲ" },
  c4Body: {
    en: "Sahay reads the deal out loud. You say yes, or tap Yes. Only then does it order, and your yes goes into the record.",
    hi: "सहाय सौदा पढ़कर सुनाता है। आप हाँ कहें या हाँ दबाएँ। तभी ऑर्डर जाता है, और आपकी हाँ रिकॉर्ड में लिखी जाती है।",
    kn: "ಸಹಾಯ್ ವ್ಯವಹಾರವನ್ನು ಓದಿ ಹೇಳುತ್ತದೆ. ನೀವು ಹೌದು ಎನ್ನಿ ಅಥವಾ ಹೌದು ಒತ್ತಿ. ಆಗ ಮಾತ್ರ ಆರ್ಡರ್ ಹೋಗುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ದಾಖಲೆಯಲ್ಲಿ ಬರೆಯಲಾಗುತ್ತದೆ.",
  },
  c4Alt: {
    en: "Example deal: seller 01, 55 rupees a kilo, 50 kilos, 2,750 rupees in all.",
    hi: "उदाहरण सौदा: विक्रेता 01, पचपन रुपये किलो, 50 किलो, कुल दो हज़ार सात सौ पचास रुपये।",
    kn: "ಉದಾಹರಣೆ ವ್ಯವಹಾರ: ಮಾರಾಟಗಾರ 01, ಕಿಲೋಗೆ ಐವತ್ತೈದು ರೂಪಾಯಿ, 50 ಕೆಜಿ, ಒಟ್ಟು ಎರಡು ಸಾವಿರದ ಏಳುನೂರ ಐವತ್ತು ರೂಪಾಯಿ.",
  },

  c5Title: { en: "Sell by voice, keep your khata", hi: "बोलकर बेचिए, खाता रखिए", kn: "ಮಾತಿನಲ್ಲೇ ಮಾರಾಟ, ಖಾತೆ ಸರಿಯಾಗಿ" },
  c5Body: {
    en: "Say who bought what. Sahay reads the bill back, makes it after your yes, and keeps track of who owes you.",
    hi: "बताइए किसने क्या लिया। सहाय बिल पढ़कर सुनाता है, आपकी हाँ के बाद बनाता है, और याद रखता है कि किस पर कितना बाक़ी है।",
    kn: "ಯಾರು ಏನು ಕೊಂಡರು ಎಂದು ಹೇಳಿ. ಸಹಾಯ್ ಬಿಲ್ ಓದಿ ಹೇಳುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ ಮಾಡುತ್ತದೆ, ಯಾರು ಎಷ್ಟು ಬಾಕಿ ಎಂದು ನೆನಪಿಡುತ್ತದೆ.",
  },
  billHead: { en: "Bill", hi: "बिल", kn: "ಬಿಲ್" },
  billPdf: { en: "PDF, ready to share", hi: "PDF, भेजने के लिए तैयार", kn: "PDF, ಕಳುಹಿಸಲು ಸಿದ್ಧ" },
  customer01: { en: "customer 01", hi: "ग्राहक 01", kn: "ಗ್ರಾಹಕ 01" },
  owes: { en: "owes", hi: "पर बाक़ी", kn: "ಬಾಕಿ" },
  reminder: {
    en: "A polite reminder goes only after your yes.",
    hi: "विनम्र याद-दिहानी आपकी हाँ के बाद ही जाती है।",
    kn: "ವಿನಯದ ನೆನಪೋಲೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ ಹೋಗುತ್ತದೆ.",
  },
  c5Alt: {
    en: "Example: a bill for 12 kilos of rice, 744 rupees, as a PDF; the khata shows customer 01 owes 744 rupees, and a reminder is sent only after your yes.",
    hi: "उदाहरण: 12 किलो चावल का बिल, सात सौ चवालीस रुपये, PDF में; खाते में ग्राहक 01 पर सात सौ चवालीस रुपये बाक़ी, और याद-दिहानी आपकी हाँ के बाद ही।",
    kn: "ಉದಾಹರಣೆ: 12 ಕೆಜಿ ಅಕ್ಕಿಯ ಬಿಲ್, ಏಳುನೂರ ನಲವತ್ತನಾಲ್ಕು ರೂಪಾಯಿ, PDF ಆಗಿ; ಖಾತೆಯಲ್ಲಿ ಗ್ರಾಹಕ 01 ಏಳುನೂರ ನಲವತ್ತನಾಲ್ಕು ರೂಪಾಯಿ ಬಾಕಿ, ನೆನಪೋಲೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ.",
  },

  c6Title: { en: "Every bill takes stock out", hi: "हर बिल से स्टॉक घटता है", kn: "ಪ್ರತಿ ಬಿಲ್ ದಾಸ್ತಾನು ಕಡಿಮೆ ಮಾಡುತ್ತದೆ" },
  c6Body: {
    en: "You set the level for each item. When stock falls below it, Sahay tells you.",
    hi: "हर सामान की सीमा आप तय करते हैं। स्टॉक उससे नीचे जाए तो सहाय बताता है।",
    kn: "ಪ್ರತಿ ವಸ್ತುವಿನ ಮಟ್ಟವನ್ನು ನೀವು ನಿಗದಿ ಮಾಡುತ್ತೀರಿ. ದಾಸ್ತಾನು ಅದಕ್ಕಿಂತ ಕೆಳಗೆ ಹೋದಾಗ ಸಹಾಯ್ ತಿಳಿಸುತ್ತದೆ.",
  },
  yourLevel: { en: "your level 40 kg", hi: "आपकी सीमा 40 किलो", kn: "ನಿಮ್ಮ ಮಟ್ಟ 40 ಕೆಜಿ" },
  belowLevel: { en: "Below your level", hi: "आपकी सीमा से नीचे", kn: "ನಿಮ್ಮ ಮಟ್ಟಕ್ಕಿಂತ ಕೆಳಗೆ" },
  c6Alt: {
    en: "Example: rice stock falls to 35 kilos, below the owner's level of 40 kilos.",
    hi: "उदाहरण: चावल का स्टॉक 35 किलो पर आ गया, मालिक की 40 किलो की सीमा से नीचे।",
    kn: "ಉದಾಹರಣೆ: ಅಕ್ಕಿ ದಾಸ್ತಾನು 35 ಕೆಜಿಗೆ ಇಳಿದಿದೆ, ಮಾಲೀಕರ 40 ಕೆಜಿ ಮಟ್ಟಕ್ಕಿಂತ ಕೆಳಗೆ.",
  },

  c7Title: { en: "It asks before it buys again", hi: "दोबारा ख़रीदने से पहले पूछता है", kn: "ಮತ್ತೆ ಖರೀದಿಸುವ ಮೊದಲು ಕೇಳುತ್ತದೆ" },
  c7Body: {
    en: "Sahay offers the last good deal again. Say yes and the loop starts over; say no and nothing happens.",
    hi: "सहाय पिछला अच्छा सौदा फिर से सामने रखता है। हाँ कहें तो चक्र फिर शुरू; ना कहें तो कुछ नहीं होता।",
    kn: "ಸಹಾಯ್ ಹಿಂದಿನ ಒಳ್ಳೆಯ ವ್ಯವಹಾರವನ್ನು ಮತ್ತೆ ಮುಂದಿಡುತ್ತದೆ. ಹೌದು ಎಂದರೆ ಚಕ್ರ ಮತ್ತೆ ಶುರು; ಬೇಡ ಎಂದರೆ ಏನೂ ಆಗುವುದಿಲ್ಲ.",
  },
  loopSell: { en: "Sold", hi: "बिका", kn: "ಮಾರಾಟ" },
  loopLow: { en: "Stock low", hi: "स्टॉक कम", kn: "ದಾಸ್ತಾನು ಕಡಿಮೆ" },
  loopBuy: { en: "Buy again", hi: "फिर ख़रीदें", kn: "ಮತ್ತೆ ಖರೀದಿ" },
  askAgain: {
    en: "Rice is at 35 kg. Buy 50 kg again from seller 01 at ₹55 a kilo?",
    hi: "चावल 35 किलो बचा है। विक्रेता 01 से ₹55 किलो पर फिर 50 किलो लें?",
    kn: "ಅಕ್ಕಿ 35 ಕೆಜಿ ಇದೆ. ಮಾರಾಟಗಾರ 01 ಇಂದ ಕಿಲೋಗೆ ₹55 ರಂತೆ ಮತ್ತೆ 50 ಕೆಜಿ ತರೋಣವೇ?",
  },
  yes: { en: "Yes", hi: "हाँ", kn: "ಹೌದು" },
  no: { en: "No", hi: "नहीं", kn: "ಬೇಡ" },
  c7Alt: {
    en: "Example: Sahay asks whether to buy 50 kilos of rice again from seller 01 at 55 rupees a kilo, with a yes and a no. Nothing is bought until the owner says yes.",
    hi: "उदाहरण: सहाय पूछता है कि क्या विक्रेता 01 से पचपन रुपये किलो पर फिर 50 किलो चावल लें, हाँ और नहीं के साथ। मालिक की हाँ तक कुछ नहीं ख़रीदा जाता।",
    kn: "ಉದಾಹರಣೆ: ಮಾರಾಟಗಾರ 01 ಇಂದ ಕಿಲೋಗೆ ಐವತ್ತೈದು ರೂಪಾಯಿಗೆ ಮತ್ತೆ 50 ಕೆಜಿ ಅಕ್ಕಿ ತರಲೇ ಎಂದು ಸಹಾಯ್ ಕೇಳುತ್ತದೆ, ಹೌದು ಮತ್ತು ಬೇಡ ಜೊತೆ. ಮಾಲೀಕರು ಹೌದು ಎನ್ನುವವರೆಗೆ ಏನೂ ಖರೀದಿಯಾಗುವುದಿಲ್ಲ.",
  },

  c8Title: { en: "Your language, both ways", hi: "आपकी भाषा, दोनों तरफ़", kn: "ನಿಮ್ಮ ಭಾಷೆ, ಎರಡೂ ಕಡೆ" },
  c8Body: {
    en: "Sahay answers in the language you spoke, in its own script. Choose the language for this page here.",
    hi: "सहाय उसी भाषा में जवाब देता है जिसमें आप बोले, उसकी अपनी लिपि में। इस पेज की भाषा यहाँ चुनें।",
    kn: "ನೀವು ಮಾತನಾಡಿದ ಭಾಷೆಯಲ್ಲೇ, ಅದರ ಸ್ವಂತ ಲಿಪಿಯಲ್ಲೇ ಸಹಾಯ್ ಉತ್ತರಿಸುತ್ತದೆ. ಈ ಪುಟದ ಭಾಷೆಯನ್ನು ಇಲ್ಲಿ ಆರಿಸಿ.",
  },

  creditsTitle: { en: "Built on", hi: "किस पर बना", kn: "ಯಾವುದರ ಮೇಲೆ ನಿರ್ಮಿತ" },
  creditsNote: {
    en: "Agora runs the live voice call, Sarvam hears Hindi, Kannada and English, and Murf Falcon speaks the replies.",
    hi: "Agora लाइव कॉल चलाता है, Sarvam हिन्दी, कन्नड़ और अंग्रेज़ी सुनता है, और Murf Falcon जवाब बोलता है।",
    kn: "Agora ನೇರ ಧ್ವನಿ ಕರೆ ನಡೆಸುತ್ತದೆ, Sarvam ಹಿಂದಿ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಕೇಳುತ್ತದೆ, Murf Falcon ಉತ್ತರಗಳನ್ನು ಹೇಳುತ್ತದೆ.",
  },


  footLine: {
    en: "A voice assistant for Indian shops: buying, bills, khata and stock.",
    hi: "भारतीय दुकानों के लिए आवाज़ वाला सहायक: ख़रीद, बिल, खाता और स्टॉक।",
    kn: "ಭಾರತೀಯ ಅಂಗಡಿಗಳಿಗೆ ಧ್ವನಿ ಸಹಾಯಕ: ಖರೀದಿ, ಬಿಲ್, ಖಾತೆ ಮತ್ತು ದಾಸ್ತಾನು.",
  },
  footNav: { en: "Footer", hi: "नीचे के लिंक", kn: "ಕೆಳಗಿನ ಲಿಂಕ್‌ಗಳು" },
  footNotice: {
    en: "Sahay is an automated assistant. It never orders or pays without your yes.",
    hi: "सहाय एक स्वचालित सहायक है। आपकी हाँ के बिना यह न ऑर्डर देता है, न भुगतान करता है।",
    kn: "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಇದು ಆರ್ಡರ್ ಮಾಡುವುದಿಲ್ಲ, ಹಣ ಪಾವತಿಸುವುದಿಲ್ಲ.",
  },
  footSim: {
    en: "A simulated vendor is always labelled \"simulated vendor\".",
    hi: "सिम्युलेटेड विक्रेता पर हमेशा \"simulated vendor\" लिखा रहता है।",
    kn: "ಅನುಕರಿಸಿದ ಮಾರಾಟಗಾರರ ಮೇಲೆ ಯಾವಾಗಲೂ \"simulated vendor\" ಎಂದು ಬರೆದಿರುತ್ತದೆ.",
  },
  footTest: {
    en: "Payments run in Razorpay test mode. Names and numbers in the pictures on this page are examples.",
    hi: "भुगतान Razorpay टेस्ट मोड में चलते हैं। इस पेज के चित्रों के नाम और अंक उदाहरण हैं।",
    kn: "ಪಾವತಿಗಳು Razorpay ಪರೀಕ್ಷಾ ಮೋಡ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತವೆ. ಈ ಪುಟದ ಚಿತ್ರಗಳಲ್ಲಿನ ಹೆಸರು, ಅಂಕೆಗಳು ಉದಾಹರಣೆಗಳು.",
  },
};

/** Each language's own name, written in its own script (never translated). */
export const LANG_NAMES = Object.freeze({ en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" });

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
    const on = String(btn.dataset.lang === lang);
    if (btn.getAttribute("role") === "menuitemradio") btn.setAttribute("aria-checked", on);
    else btn.setAttribute("aria-pressed", on);
  }
}
