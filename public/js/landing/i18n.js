// Landing page words in English, Hindi (Devanagari) and Kannada (Kannada script).
// True copy only: no invented numbers or usage claims; every number on the page is a fact about
// Sahay itself (3 languages, 7 jobs, 4 steps, 1 yes, 0 orders without you).

export const LANGS = ["hi", "kn", "en"];

const S = {
  skip: { en: "Skip to content", hi: "सीधे मुख्य भाग पर जाएँ", kn: "ಮುಖ್ಯ ಭಾಗಕ್ಕೆ ಹೋಗಿ" },
  brandTop: { en: "Sahay, back to top", hi: "सहाय, ऊपर जाएँ", kn: "ಸಹಾಯ್, ಮೇಲಕ್ಕೆ ಹೋಗಿ" },
  aiChip: { en: "Automated assistant", hi: "स्वचालित सहायक", kn: "ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ" },
  navLabel: { en: "Page", hi: "पेज", kn: "ಪುಟ" },
  navHow: { en: "How it works", hi: "कैसे चलता है", kn: "ಹೇಗೆ ನಡೆಯುತ್ತದೆ" },
  navDoes: { en: "What it does", hi: "क्या करता है", kn: "ಏನು ಮಾಡುತ್ತದೆ" },
  navBuilt: { en: "Built on", hi: "किस पर बना", kn: "ಯಾವುದರ ಮೇಲೆ" },
  navLangs: { en: "Languages", hi: "भाषाएँ", kn: "ಭಾಷೆಗಳು" },
  navFaq: { en: "FAQ", hi: "सवाल", kn: "ಪ್ರಶ್ನೆಗಳು" },
  menu: { en: "Menu", hi: "मेन्यू", kn: "ಮೆನು" },
  menuClose: { en: "Close menu", hi: "मेन्यू बंद करें", kn: "ಮೆನು ಮುಚ್ಚಿ" },
  langChoose: { en: "Choose your language", hi: "अपनी भाषा चुनें", kn: "ನಿಮ್ಮ ಭಾಷೆ ಆರಿಸಿ" },
  // "Language: <name>" on the switcher (the name is always in its own script).
  langCurrent: { en: "Language: {name}", hi: "भाषा: {name}", kn: "ಭಾಷೆ: {name}" },
  // Kept for the shared theme contract (the landing has one look).
  toLight: { en: "Switch to light", hi: "हल्का रंग", kn: "ತಿಳಿ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  toDark: { en: "Switch to dark", hi: "गहरा रंग", kn: "ಗಾಢ ಬಣ್ಣಕ್ಕೆ ಬದಲಿಸಿ" },
  openSahay: { en: "Open Sahay", hi: "सहाय खोलें", kn: "ಸಹಾಯ್ ತೆರೆಯಿರಿ" },
  logIn: { en: "Log in", hi: "लॉग इन", kn: "ಲಾಗ್ ಇನ್" },
  prev: { en: "Previous", hi: "पिछला", kn: "ಹಿಂದಿನದು" },
  next: { en: "Next", hi: "अगला", kn: "ಮುಂದಿನದು" },

  // ---- Hero ----
  heroKicker: { en: "A voice assistant for Indian shops", hi: "भारतीय दुकानों के लिए आवाज़ वाला सहायक", kn: "ಭಾರತೀಯ ಅಂಗಡಿಗಳಿಗೆ ಧ್ವನಿ ಸಹಾಯಕ" },
  heroLine: { en: "Your shop's assistant", hi: "आपकी दुकान का सहायक", kn: "ನಿಮ್ಮ ಅಂಗಡಿಯ ಸಹಾಯಕ" },
  heroJobs: { en: "Buying · Bills · Khata · Stock", hi: "ख़रीद · बिल · खाता · स्टॉक", kn: "ಖರೀದಿ · ಬಿಲ್ · ಖಾತೆ · ದಾಸ್ತಾನು" },
  heroMore: { en: "See how it works", hi: "देखिए कैसे चलता है", kn: "ಹೇಗೆ ನಡೆಯುತ್ತದೆ ನೋಡಿ" },
  heroPromise: { en: "Nothing is ordered without your yes", hi: "आपकी हाँ के बिना कोई ऑर्डर नहीं", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಇಲ್ಲ" },
  heroAlt: {
    en: "Picture: a kirana shop on a floating island under the moon, with the shopkeeper, a mango tree, and a delivery tempo with its supplier.",
    hi: "चित्र: चाँद के नीचे तैरते टापू पर एक किराना दुकान, दुकानदार, आम का पेड़, और सप्लायर के साथ डिलीवरी टेम्पो।",
    kn: "ಚಿತ್ರ: ಚಂದ್ರನ ಕೆಳಗೆ ತೇಲುವ ದ್ವೀಪದ ಮೇಲೆ ಒಂದು ಕಿರಾಣಿ ಅಂಗಡಿ, ಅಂಗಡಿಯವರು, ಮಾವಿನ ಮರ, ಮತ್ತು ಸರಬರಾಜುದಾರರ ಜೊತೆ ಡೆಲಿವರಿ ಟೆಂಪೋ.",
  },
  modelAlt: {
    en: "Picture: a market street with four kirana shops, a vegetable cart, a parked tempo and shoppers.",
    hi: "चित्र: चार किराना दुकानों वाली बाज़ार की गली, सब्ज़ी का ठेला, खड़ा टेम्पो और ख़रीदार।",
    kn: "ಚಿತ್ರ: ನಾಲ್ಕು ಕಿರಾಣಿ ಅಂಗಡಿಗಳಿರುವ ಮಾರುಕಟ್ಟೆ ಬೀದಿ, ತರಕಾರಿ ಗಾಡಿ, ನಿಲ್ಲಿಸಿದ ಟೆಂಪೋ ಮತ್ತು ಗ್ರಾಹಕರು.",
  },
  heroSub: {
    en: "Say what you need in Hindi, Kannada or English, and Sahay finds sellers, bargains, makes bills and tracks stock while you mind the counter.",
    hi: "हिन्दी, कन्नड़ या अंग्रेज़ी में बताइए क्या चाहिए, और जब तक आप काउंटर सँभालते हैं, सहाय विक्रेता ढूँढता है, मोलभाव करता है, बिल बनाता है और स्टॉक पर नज़र रखता है।",
    kn: "ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ; ನೀವು ಕೌಂಟರ್ ನೋಡಿಕೊಳ್ಳುವಾಗ ಸಹಾಯ್ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ, ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ, ಬಿಲ್ ಮಾಡುತ್ತದೆ, ದಾಸ್ತಾನು ನೋಡಿಕೊಳ್ಳುತ್ತದೆ.",
  },

  // ---- About (paper) ----
  aboutA: { en: "Sahay buys for your shop,", hi: "सहाय आपकी दुकान के लिए ख़रीदता है,", kn: "ಸಹಾಯ್ ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಖರೀದಿಸುತ್ತದೆ," },
  aboutB: { en: "while you mind the counter.", hi: "जब तक आप काउंटर सँभालते हैं।", kn: "ನೀವು ಕೌಂಟರ್ ನೋಡಿಕೊಳ್ಳುವಾಗಲೇ." },
  guideKicker: { en: "Shop guide", hi: "दुकान का साथी", kn: "ಅಂಗಡಿಯ ಸಂಗಾತಿ" },
  guideSub: { en: "Your first order starts with your voice.", hi: "आपका पहला ऑर्डर आपकी आवाज़ से शुरू होता है।", kn: "ನಿಮ್ಮ ಮೊದಲ ಆರ್ಡರ್ ನಿಮ್ಮ ಧ್ವನಿಯಿಂದಲೇ ಶುರು." },
  yourShop: { en: "Your shop", hi: "आपकी दुकान", kn: "ನಿಮ್ಮ ಅಂಗಡಿ" },
  sellersNear: { en: "Sellers near you", hi: "आपके पास के विक्रेता", kn: "ನಿಮ್ಮ ಹತ್ತಿರದ ಮಾರಾಟಗಾರರು" },
  statLangs: { en: "Languages", hi: "भाषाएँ", kn: "ಭಾಷೆಗಳು" },
  statJobs: { en: "Jobs it does", hi: "काम जो यह करता है", kn: "ಅದು ಮಾಡುವ ಕೆಲಸಗಳು" },
  statSteps: { en: "Steps from need to order", hi: "ज़रूरत से ऑर्डर तक क़दम", kn: "ಅಗತ್ಯದಿಂದ ಆರ್ಡರ್‌ವರೆಗೆ ಹಂತಗಳು" },
  statYes: { en: "Yes before every order", hi: "हर ऑर्डर से पहले हाँ", kn: "ಪ್ರತಿ ಆರ್ಡರ್‌ಗೂ ಮುನ್ನ ಒಪ್ಪಿಗೆ" },
  statNone: { en: "Orders without you", hi: "आपके बिना ऑर्डर", kn: "ನಿಮ್ಮಿಲ್ಲದೆ ಆರ್ಡರ್" },

  // ---- What Sahay does (night carousel) ----
  doesTitle: { en: "What Sahay does", hi: "सहाय क्या करता है", kn: "ಸಹಾಯ್ ಏನು ಮಾಡುತ್ತದೆ" },
  fBuy: { en: "Buy", hi: "ख़रीद", kn: "ಖರೀದಿ" },
  fBuyCat: { en: "Buying", hi: "ख़रीदारी", kn: "ಖರೀದಿ" },
  fBuyLine: { en: "Say it. Sahay finds the price.", hi: "बस बोलिए। दाम सहाय ढूँढेगा।", kn: "ಹೇಳಿ ಸಾಕು. ಬೆಲೆ ಸಹಾಯ್ ಹುಡುಕುತ್ತದೆ." },
  fBuyText: {
    en: "Tell Sahay what you need. It contacts sellers, bargains round by round, and brings you the deal.",
    hi: "सहाय को बताइए क्या चाहिए। यह विक्रेताओं से बात करता है, दौर-दर-दौर मोलभाव करता है, और सौदा आपके सामने रखता है।",
    kn: "ಏನು ಬೇಕು ಎಂದು ಸಹಾಯ್‌ಗೆ ಹೇಳಿ. ಅದು ಮಾರಾಟಗಾರರನ್ನು ಸಂಪರ್ಕಿಸಿ, ಸುತ್ತು ಸುತ್ತಾಗಿ ಚೌಕಾಸಿ ಮಾಡಿ, ವ್ಯವಹಾರವನ್ನು ನಿಮ್ಮ ಮುಂದಿಡುತ್ತದೆ.",
  },
  fBuyFact: { en: "Orders only after your yes", hi: "ऑर्डर सिर्फ़ आपकी हाँ के बाद", kn: "ಆರ್ಡರ್ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ" },
  fSell: { en: "Sell", hi: "बिक्री", kn: "ಮಾರಾಟ" },
  fSellCat: { en: "Bills", hi: "बिल", kn: "ಬಿಲ್" },
  fSellLine: { en: "Say who bought what.", hi: "बताइए किसने क्या लिया।", kn: "ಯಾರು ಏನು ಕೊಂಡರು ಎಂದು ಹೇಳಿ." },
  fSellText: {
    en: "Sahay reads the bill back and makes it after your yes, as a PDF ready to share.",
    hi: "सहाय बिल पढ़कर सुनाता है और आपकी हाँ के बाद बनाता है, भेजने के लिए तैयार PDF में।",
    kn: "ಸಹಾಯ್ ಬಿಲ್ ಓದಿ ಹೇಳಿ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ ಮಾಡುತ್ತದೆ, ಕಳುಹಿಸಲು ಸಿದ್ಧವಾದ PDF ಆಗಿ.",
  },
  fSellFact: { en: "Bill after your yes", hi: "बिल आपकी हाँ के बाद", kn: "ಬಿಲ್ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ" },
  fStock: { en: "Stock", hi: "स्टॉक", kn: "ದಾಸ್ತಾನು" },
  fStockCat: { en: "Stock levels", hi: "स्टॉक की सीमा", kn: "ದಾಸ್ತಾನು ಮಟ್ಟ" },
  c6Title: { en: "Every bill takes stock out", hi: "हर बिल से स्टॉक घटता है", kn: "ಪ್ರತಿ ಬಿಲ್ ದಾಸ್ತಾನು ಕಡಿಮೆ ಮಾಡುತ್ತದೆ" },
  c6Body: {
    en: "You set the level for each item. When stock falls below it, Sahay tells you.",
    hi: "हर सामान की सीमा आप तय करते हैं। स्टॉक उससे नीचे जाए तो सहाय बताता है।",
    kn: "ಪ್ರತಿ ವಸ್ತುವಿನ ಮಟ್ಟವನ್ನು ನೀವು ನಿಗದಿ ಮಾಡುತ್ತೀರಿ. ದಾಸ್ತಾನು ಅದಕ್ಕಿಂತ ಕೆಳಗೆ ಹೋದಾಗ ಸಹಾಯ್ ತಿಳಿಸುತ್ತದೆ.",
  },
  fStockFact: { en: "Alerts below your level", hi: "सीमा से नीचे तो सूचना", kn: "ಮಟ್ಟಕ್ಕಿಂತ ಕೆಳಗಾದರೆ ಸೂಚನೆ" },
  fKhata: { en: "Khata", hi: "खाता", kn: "ಖಾತೆ" },
  fKhataCat: { en: "Who owes you", hi: "किस पर बाक़ी", kn: "ಯಾರ ಬಾಕಿ" },
  fKhataLine: { en: "Who owes you, and how much.", hi: "किस पर कितना बाक़ी है।", kn: "ಯಾರು ಎಷ್ಟು ಬಾಕಿ ಕೊಡಬೇಕು." },
  fKhataText: {
    en: "Sahay keeps track of who owes you. A polite reminder goes only after your yes.",
    hi: "सहाय याद रखता है कि किस पर कितना बाक़ी है। विनम्र याद-दिहानी आपकी हाँ के बाद ही जाती है।",
    kn: "ಯಾರು ಎಷ್ಟು ಬಾಕಿ ಎಂದು ಸಹಾಯ್ ನೆನಪಿಡುತ್ತದೆ. ವಿನಯದ ನೆನಪೋಲೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ ಹೋಗುತ್ತದೆ.",
  },
  fKhataFact: { en: "Reminders after your yes", hi: "याद-दिहानी आपकी हाँ के बाद", kn: "ನೆನಪೋಲೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ" },
  fMoney: { en: "Money", hi: "पैसा", kn: "ಹಣ" },
  fMoneyCat: { en: "Payments", hi: "भुगतान", kn: "ಪಾವತಿ" },
  fMoneyLine: { en: "Owed, to pay, received.", hi: "बाक़ी, देना, मिला।", kn: "ಬಾಕಿ, ಕೊಡಬೇಕಾದ್ದು, ಬಂದದ್ದು." },
  fMoneyText: {
    en: "Who owes you, what you must pay, and what came in, in one list.",
    hi: "किस पर बाक़ी है, आपको क्या चुकाना है, और क्या आया, एक ही सूची में।",
    kn: "ಯಾರು ಬಾಕಿ ಕೊಡಬೇಕು, ನೀವು ಏನು ಕೊಡಬೇಕು, ಏನು ಬಂತು, ಎಲ್ಲವೂ ಒಂದೇ ಪಟ್ಟಿಯಲ್ಲಿ.",
  },
  fMoneyFact: { en: "Razorpay test mode", hi: "Razorpay टेस्ट मोड", kn: "Razorpay ಪರೀಕ್ಷಾ ಮೋಡ್" },
  fRules: { en: "Rules", hi: "नियम", kn: "ನಿಯಮಗಳು" },
  fRulesCat: { en: "Your rules", hi: "आपके नियम", kn: "ನಿಮ್ಮ ನಿಯಮಗಳು" },
  fRulesLine: { en: "You decide how it works.", hi: "यह कैसे काम करे, आप तय करें।", kn: "ಅದು ಹೇಗೆ ಕೆಲಸ ಮಾಡಬೇಕು ಎಂದು ನೀವೇ ನಿರ್ಧರಿಸಿ." },
  fRulesText: {
    en: "Choose how hard Sahay bargains, its language and its speaking speed. Asking before every order always stays on.",
    hi: "चुनिए सहाय कितना मोलभाव करे, किस भाषा में और किस रफ़्तार से बोले। हर ऑर्डर से पहले पूछना हमेशा चालू रहता है।",
    kn: "ಸಹಾಯ್ ಎಷ್ಟು ಚೌಕಾಸಿ ಮಾಡಲಿ, ಯಾವ ಭಾಷೆ, ಎಷ್ಟು ವೇಗದಲ್ಲಿ ಮಾತನಾಡಲಿ ಎಂದು ಆರಿಸಿ. ಪ್ರತಿ ಆರ್ಡರ್‌ಗೂ ಮುನ್ನ ಕೇಳುವುದು ಯಾವಾಗಲೂ ಆನ್ ಆಗಿರುತ್ತದೆ.",
  },
  fRulesFact: { en: "Ask before order: always on", hi: "ऑर्डर से पहले पूछना: हमेशा चालू", kn: "ಆರ್ಡರ್‌ಗೂ ಮುನ್ನ ಕೇಳುವುದು: ಯಾವಾಗಲೂ ಆನ್" },
  fSellers: { en: "Sellers", hi: "विक्रेता", kn: "ಮಾರಾಟಗಾರರು" },
  s2: { en: "Real sellers", hi: "असली विक्रेता", kn: "ನಿಜ ಮಾರಾಟಗಾರರು" },
  fSellersLine: { en: "Sellers who serve your city.", hi: "आपके शहर में माल देने वाले।", kn: "ನಿಮ್ಮ ನಗರಕ್ಕೆ ಮಾಲು ಕೊಡುವವರು." },
  c2Body: {
    en: "Sellers who serve your city, from IndiaMART listings. If a source is down, Sahay says so; it never makes sellers up.",
    hi: "आपके शहर में माल देने वाले विक्रेता, IndiaMART की सूची से। कोई स्रोत बंद हो तो सहाय साफ़ बताता है; वह विक्रेता कभी गढ़ता नहीं।",
    kn: "ನಿಮ್ಮ ನಗರಕ್ಕೆ ಮಾಲು ಕೊಡುವ ಮಾರಾಟಗಾರರು, IndiaMART ಪಟ್ಟಿಯಿಂದ. ಮೂಲ ಕೆಲಸ ಮಾಡದಿದ್ದರೆ ಸಹಾಯ್ ಹಾಗೆಯೇ ಹೇಳುತ್ತದೆ; ಮಾರಾಟಗಾರರನ್ನು ಕಲ್ಪಿಸುವುದಿಲ್ಲ.",
  },
  fSellersFact: { en: "Never made up", hi: "कभी गढ़े नहीं जाते", kn: "ಎಂದೂ ಕಲ್ಪಿತವಲ್ಲ" },

  // ---- From need to order (paper, four frames) ----
  howTitle: { en: "From need to order", hi: "ज़रूरत से ऑर्डर तक", kn: "ಅಗತ್ಯದಿಂದ ಆರ್ಡರ್‌ವರೆಗೆ" },
  howSub: {
    en: "Keep serving customers at the counter. Sahay talks to sellers, bargains, and waits for your yes.",
    hi: "आप काउंटर पर ग्राहक सँभालिए। फ़ोन, मोलभाव सहाय करता है, और आपकी हाँ का इंतज़ार करता है।",
    kn: "ನೀವು ಕೌಂಟರ್‌ನಲ್ಲಿ ಗ್ರಾಹಕರನ್ನು ನೋಡಿಕೊಳ್ಳಿ. ಕರೆ, ಚೌಕಾಸಿ ಸಹಾಯ್ ಮಾಡುತ್ತದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತದೆ.",
  },
  step1: { en: "Step 1", hi: "क़दम 1", kn: "ಹಂತ 1" },
  step2: { en: "Step 2", hi: "क़दम 2", kn: "ಹಂತ 2" },
  step3: { en: "Step 3", hi: "क़दम 3", kn: "ಹಂತ 3" },
  step4: { en: "Step 4", hi: "क़दम 4", kn: "ಹಂತ 4" },
  step1Title: { en: "Say what you need", hi: "बताइए क्या चाहिए", kn: "ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ" },
  step1Copy: {
    en: "Speak the way you talk to a supplier. No menus, no item codes.",
    hi: "वैसे ही बोलिए जैसे सप्लायर से बोलते हैं। न मेन्यू, न आइटम कोड।",
    kn: "ಸರಬರಾಜುದಾರರ ಜೊತೆ ಮಾತನಾಡುವ ಹಾಗೆಯೇ ಹೇಳಿ. ಮೆನು ಇಲ್ಲ, ಐಟಂ ಕೋಡ್ ಇಲ್ಲ.",
  },
  stepFindTitle: { en: "Sahay finds sellers", hi: "सहाय विक्रेता ढूँढता है", kn: "ಸಹಾಯ್ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ" },
  stepFindCopy: {
    en: "Real sellers who serve your city. If a source is down, Sahay says so.",
    hi: "आपके शहर में माल देने वाले असली विक्रेता। कोई स्रोत बंद हो तो सहाय बताता है।",
    kn: "ನಿಮ್ಮ ನಗರಕ್ಕೆ ಮಾಲು ಕೊಡುವ ನಿಜ ಮಾರಾಟಗಾರರು. ಮೂಲ ಕೆಲಸ ಮಾಡದಿದ್ದರೆ ಸಹಾಯ್ ಹೇಳುತ್ತದೆ.",
  },
  stepBargainTitle: { en: "It bargains", hi: "यह मोलभाव करता है", kn: "ಅದು ಚೌಕಾಸಿ ಮಾಡುತ್ತದೆ" },
  step2Copy: {
    en: "It contacts sellers near you, says first that it is an automated assistant, and asks for a better price.",
    hi: "यह आपके पास के विक्रेताओं से संपर्क करता है, पहले बताता है कि यह स्वचालित सहायक है, और बेहतर दाम माँगता है।",
    kn: "ಇದು ನಿಮ್ಮ ಹತ್ತಿರದ ಮಾರಾಟಗಾರರನ್ನು ಸಂಪರ್ಕಿಸಿ, ಮೊದಲು ತಾನು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ ಎಂದು ಹೇಳಿ, ಉತ್ತಮ ಬೆಲೆ ಕೇಳುತ್ತದೆ.",
  },
  s4: { en: "Your yes", hi: "आपकी हाँ", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ" },
  step3Copy: {
    en: "Sahay reads the deal out loud. Say yes or tap Yes; only then does it order.",
    hi: "सहाय सौदा पढ़कर सुनाता है। हाँ कहें या हाँ दबाएँ; तभी ऑर्डर जाता है।",
    kn: "ಸಹಾಯ್ ವ್ಯವಹಾರವನ್ನು ಓದಿ ಹೇಳುತ್ತದೆ. ಹೌದು ಎನ್ನಿ ಅಥವಾ ಹೌದು ಒತ್ತಿ; ಆಗ ಮಾತ್ರ ಆರ್ಡರ್ ಹೋಗುತ್ತದೆ.",
  },

  // ---- Built on (night islands) ----
  creditsTitle: { en: "Built on", hi: "किस पर बना", kn: "ಯಾವುದರ ಮೇಲೆ ನಿರ್ಮಿತ" },
  creditsNote: {
    en: "Agora runs the live voice call, Sarvam hears Hindi, Kannada and English, and Murf Falcon speaks the replies.",
    hi: "Agora लाइव आवाज़ कॉल चलाता है, Sarvam हिन्दी, कन्नड़ और अंग्रेज़ी सुनता है, और Murf Falcon जवाब बोलता है।",
    kn: "Agora ನೇರ ಧ್ವನಿ ಕರೆ ನಡೆಸುತ್ತದೆ, Sarvam ಹಿಂದಿ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಕೇಳುತ್ತದೆ, Murf Falcon ಉತ್ತರಗಳನ್ನು ಹೇಳುತ್ತದೆ.",
  },
  isleAgoraK: { en: "Voice · Agora", hi: "आवाज़ · Agora", kn: "ಧ್ವನಿ · Agora" },
  isleAgora: { en: "Runs the live voice call", hi: "लाइव आवाज़ कॉल चलाता है", kn: "ನೇರ ಧ್ವನಿ ಕರೆ ನಡೆಸುತ್ತದೆ" },
  isleSarvamK: { en: "Ears · Sarvam", hi: "कान · Sarvam", kn: "ಕಿವಿ · Sarvam" },
  isleSarvam: { en: "Hears Hindi, Kannada and English", hi: "हिन्दी, कन्नड़ और अंग्रेज़ी सुनता है", kn: "ಹಿಂದಿ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಕೇಳುತ್ತದೆ" },
  isleMurfK: { en: "Speech · Murf Falcon", hi: "बोली · Murf Falcon", kn: "ಮಾತು · Murf Falcon" },
  isleMurf: { en: "Speaks the replies", hi: "जवाब बोलता है", kn: "ಉತ್ತರಗಳನ್ನು ಹೇಳುತ್ತದೆ" },

  // ---- Languages (billboards) ----
  langsA: { en: "Speaks", hi: "बोलता है", kn: "ಮಾತನಾಡುತ್ತದೆ" },
  langsB: { en: "your language", hi: "आपकी भाषा", kn: "ನಿಮ್ಮ ಭಾಷೆ" },
  langsBody: {
    en: "Talk in Hindi, Kannada or English, or mix them. Sahay answers in the language you spoke, in its own script.",
    hi: "हिन्दी, कन्नड़ या अंग्रेज़ी में बोलिए, या मिलाकर। सहाय उसी भाषा में जवाब देता है जिसमें आप बोले, उसकी अपनी लिपि में।",
    kn: "ಹಿಂದಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತನಾಡಿ, ಬೆರೆಸಿಯೂ ಆಗಬಹುದು. ನೀವು ಮಾತನಾಡಿದ ಭಾಷೆಯಲ್ಲೇ, ಅದರ ಸ್ವಂತ ಲಿಪಿಯಲ್ಲೇ ಸಹಾಯ್ ಉತ್ತರಿಸುತ್ತದೆ.",
  },
  langsCount: { en: "Languages, both ways", hi: "भाषाएँ, दोनों तरफ़", kn: "ಭಾಷೆಗಳು, ಎರಡೂ ಕಡೆ" },
  mixedK: { en: "Mixed", hi: "मिली-जुली", kn: "ಬೆರೆಸಿದ" },
  mixedWord: { en: "Mix them", hi: "मिलाकर", kn: "ಬೆರೆಸಿ" },
  mixedSub: { en: "Sahay follows", hi: "सहाय समझ लेता है", kn: "ಸಹಾಯ್ ಅರ್ಥ ಮಾಡಿಕೊಳ್ಳುತ್ತದೆ" },

  // ---- FAQ (paper) ----
  faqTitle: { en: "Questions", hi: "सवाल", kn: "ಪ್ರಶ್ನೆಗಳು" },
  faqLead: { en: "What shop owners ask first.", hi: "दुकानदार सबसे पहले यही पूछते हैं।", kn: "ಅಂಗಡಿಯವರು ಮೊದಲು ಕೇಳುವುದು ಇದನ್ನೇ." },
  mapAlt: {
    en: "Picture: a guide map with your shop and the sellers around it, joined by dotted routes.",
    hi: "चित्र: एक नक़्शा, जिसमें आपकी दुकान और आसपास के विक्रेता बिंदीदार रास्तों से जुड़े हैं।",
    kn: "ಚಿತ್ರ: ನಿಮ್ಮ ಅಂಗಡಿ ಮತ್ತು ಸುತ್ತಲಿನ ಮಾರಾಟಗಾರರನ್ನು ಚುಕ್ಕೆ ದಾರಿಗಳಿಂದ ಜೋಡಿಸಿದ ನಕ್ಷೆ.",
  },
  q1: { en: "Is Sahay a person?", hi: "क्या सहाय कोई इंसान है?", kn: "ಸಹಾಯ್ ಒಬ್ಬ ವ್ಯಕ್ತಿಯೇ?" },
  a1: {
    en: "No. Sahay is an automated assistant, and it says so in the first sentence of every call.",
    hi: "नहीं। सहाय एक स्वचालित सहायक है, और हर कॉल के पहले वाक्य में यही बताता है।",
    kn: "ಇಲ್ಲ. ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ, ಪ್ರತಿ ಕರೆಯ ಮೊದಲ ವಾಕ್ಯದಲ್ಲೇ ಅದನ್ನು ಹೇಳುತ್ತದೆ.",
  },
  q2: { en: "Can it order without me?", hi: "क्या यह मेरे बिना ऑर्डर कर सकता है?", kn: "ನನ್ನ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಆರ್ಡರ್ ಮಾಡಬಹುದೇ?" },
  a2: {
    en: "No. No order, bill or payment link is made without your spoken yes or the Yes button. Sahay bargains and prepares the deal; you decide.",
    hi: "नहीं। आपकी बोली हुई हाँ या हाँ बटन के बिना कोई ऑर्डर, बिल या भुगतान लिंक नहीं बनता। सहाय मोलभाव करके सौदा तैयार करता है; फ़ैसला आपका।",
    kn: "ಇಲ್ಲ. ನಿಮ್ಮ ಮಾತಿನ ಹೌದು ಅಥವಾ ಹೌದು ಬಟನ್ ಇಲ್ಲದೆ ಯಾವುದೇ ಆರ್ಡರ್, ಬಿಲ್ ಅಥವಾ ಪಾವತಿ ಲಿಂಕ್ ಆಗುವುದಿಲ್ಲ. ಸಹಾಯ್ ಚೌಕಾಸಿ ಮಾಡಿ ವ್ಯವಹಾರ ಸಿದ್ಧಪಡಿಸುತ್ತದೆ; ನಿರ್ಧಾರ ನಿಮ್ಮದು.",
  },
  q3: { en: "Which languages does it speak?", hi: "यह कौन-सी भाषाएँ बोलता है?", kn: "ಅದು ಯಾವ ಭಾಷೆಗಳನ್ನು ಮಾತನಾಡುತ್ತದೆ?" },
  q4: { en: "Where do the sellers come from?", hi: "विक्रेता कहाँ से आते हैं?", kn: "ಮಾರಾಟಗಾರರು ಎಲ್ಲಿಂದ ಬರುತ್ತಾರೆ?" },
  q5: { en: "Are the payments real?", hi: "क्या भुगतान असली हैं?", kn: "ಪಾವತಿಗಳು ನಿಜವೇ?" },
  a5: {
    en: "Not yet. Payments run in Razorpay test mode, and a simulated vendor is always labelled \"simulated vendor\".",
    hi: "अभी नहीं। भुगतान Razorpay टेस्ट मोड में चलते हैं, और सिम्युलेटेड विक्रेता पर हमेशा \"simulated vendor\" लिखा रहता है।",
    kn: "ಇನ್ನೂ ಇಲ್ಲ. ಪಾವತಿಗಳು Razorpay ಪರೀಕ್ಷಾ ಮೋಡ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತವೆ, ಅನುಕರಿಸಿದ ಮಾರಾಟಗಾರರ ಮೇಲೆ ಯಾವಾಗಲೂ \"simulated vendor\" ಎಂದು ಬರೆದಿರುತ್ತದೆ.",
  },
  q6: { en: "What do I need to start?", hi: "शुरू करने के लिए क्या चाहिए?", kn: "ಶುರು ಮಾಡಲು ಏನು ಬೇಕು?" },
  a6: {
    en: "A phone or laptop with a microphone. Open Sahay, sign up with your phone number and a PIN, and say what you need.",
    hi: "माइक वाला फ़ोन या लैपटॉप। सहाय खोलिए, अपने मोबाइल नंबर और पिन से खाता बनाइए, और बताइए क्या चाहिए।",
    kn: "ಮೈಕ್ ಇರುವ ಫೋನ್ ಅಥವಾ ಲ್ಯಾಪ್‌ಟಾಪ್. ಸಹಾಯ್ ತೆರೆಯಿರಿ, ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಮತ್ತು ಪಿನ್‌ನಿಂದ ಖಾತೆ ಮಾಡಿ, ಏನು ಬೇಕು ಎಂದು ಹೇಳಿ.",
  },

  // ---- Footer ----
  footLine: {
    en: "A voice assistant for Indian shops: buying, bills, khata and stock.",
    hi: "भारतीय दुकानों के लिए आवाज़ वाला सहायक: ख़रीद, बिल, खाता और स्टॉक।",
    kn: "ಭಾರತೀಯ ಅಂಗಡಿಗಳಿಗೆ ಧ್ವನಿ ಸಹಾಯಕ: ಖರೀದಿ, ಬಿಲ್, ಖಾತೆ ಮತ್ತು ದಾಸ್ತಾನು.",
  },
  footNav: { en: "Footer", hi: "नीचे के लिंक", kn: "ಕೆಳಗಿನ ಲಿಂಕ್‌ಗಳು" },
  footTagA: { en: "Your shop,", hi: "आपकी दुकान,", kn: "ನಿಮ್ಮ ಅಂಗಡಿ," },
  footTagB: { en: "your yes.", hi: "आपकी हाँ।", kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ." },
  footNever: {
    en: "It never orders or pays without your yes.",
    hi: "आपकी हाँ के बिना यह न ऑर्डर देता है, न भुगतान करता है।",
    kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಇದು ಆರ್ಡರ್ ಮಾಡುವುದಿಲ್ಲ, ಹಣ ಪಾವತಿಸುವುದಿಲ್ಲ.",
  },
  footCode: { en: "Code on GitHub", hi: "GitHub पर कोड", kn: "GitHub ನಲ್ಲಿ ಕೋಡ್" },
  footArt: {
    en: "Pixel picture at night: a shop owner at the counter, Sahay in the middle as a small round helper, and a supplier with a delivery tempo.",
    hi: "रात का पिक्सेल चित्र: काउंटर पर दुकानदार, बीच में छोटे गोल साथी जैसा सहाय, और डिलीवरी टेम्पो के साथ सप्लायर।",
    kn: "ರಾತ್ರಿಯ ಪಿಕ್ಸೆಲ್ ಚಿತ್ರ: ಕೌಂಟರ್ ಬಳಿ ಅಂಗಡಿಯವರು, ನಡುವೆ ಚಿಕ್ಕ ದುಂಡನೆಯ ಸಹಾಯಕನಂತೆ ಸಹಾಯ್, ಮತ್ತು ಡೆಲಿವರಿ ಟೆಂಪೋ ಜೊತೆ ಸರಬರಾಜುದಾರ.",
  },
  footDisclose: {
    en: "Sahay is an automated assistant. Payments are in test mode.",
    hi: "सहाय एक स्वचालित सहायक है। भुगतान टेस्ट मोड में हैं।",
    kn: "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ಪಾವತಿಗಳು ಪರೀಕ್ಷಾ ಮೋಡ್‌ನಲ್ಲಿವೆ.",
  },
  footSim: {
    en: "A simulated vendor is always labelled \"simulated vendor\".",
    hi: "सिम्युलेटेड विक्रेता पर हमेशा \"simulated vendor\" लिखा रहता है।",
    kn: "ಅನುಕರಿಸಿದ ಮಾರಾಟಗಾರರ ಮೇಲೆ ಯಾವಾಗಲೂ \"simulated vendor\" ಎಂದು ಬರೆದಿರುತ್ತದೆ.",
  },
  footExamples: {
    en: "Names and numbers in the pictures on this page are examples.",
    hi: "इस पेज के चित्रों के नाम और अंक उदाहरण हैं।",
    kn: "ಈ ಪುಟದ ಚಿತ್ರಗಳಲ್ಲಿನ ಹೆಸರು, ಅಂಕೆಗಳು ಉದಾಹರಣೆಗಳು.",
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
