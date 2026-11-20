// Every owner-facing string in three languages, native script. The language is the business
// language, overridden by the agent profile when the owner changes it in My Sahay.
// Owner words: need / price / total / work (never requirement / quote / landed cost / job).

const T = {
  "app.name": ["Sahay", "सहाय", "ಸಹಾಯ್"],
  "notice.short": ["Automated assistant", "स्वचालित सहायक", "ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"],
  "notice.long": [
    "Sahay is an automated assistant. Nothing is bought without your yes.",
    "सहाय एक स्वचालित सहायक है। आपकी हाँ के बिना कुछ नहीं खरीदा जाता।",
    "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನನ್ನೂ ಖರೀದಿಸುವುದಿಲ್ಲ.",
  ],
  "skip": ["Skip to main screen", "मुख्य हिस्से पर जाएँ", "ಮುಖ್ಯ ಭಾಗಕ್ಕೆ ಹೋಗಿ"],

  "nav.label": ["Main", "मुख्य", "ಮುಖ್ಯ"],
  "nav.talk": ["Talk", "बात", "ಮಾತು"],
  "nav.work": ["Work", "काम", "ಕೆಲಸ"],
  "nav.orders": ["Orders", "ऑर्डर", "ಆರ್ಡರ್"],
  "nav.me": ["My Sahay", "मेरा सहाय", "ನನ್ನ ಸಹಾಯ್"],
  "nav.buy": ["Buy", "खरीदें", "ಖರೀದಿ"],
  "nav.sell": ["Sell", "बेचें", "ಮಾರಾಟ"],
  "nav.stock": ["Stock", "माल", "ಸ್ಟಾಕ್"],
  "nav.money": ["Money", "पैसा", "ಹಣ"],
  "nav.signup": ["Make my Sahay", "मेरा सहाय बनाएँ", "ನನ್ನ ಸಹಾಯ್ ಮಾಡಿ"],
  "nav.login": ["Log in", "लॉग इन", "ಲಾಗಿನ್"],
  "nav.history": ["History", "इतिहास", "ಇತಿಹಾಸ"],
  "live.open": ["Live", "चालू", "ಲೈವ್"],
  "live.connecting": ["Connecting", "जुड़ रहा है", "ಸಂಪರ್ಕಿಸುತ್ತಿದೆ"],
  "live.reconnecting": ["Reconnecting", "फिर जुड़ रहा है", "ಮತ್ತೆ ಸಂಪರ್ಕಿಸುತ್ತಿದೆ"],
  "live.closed": ["Offline", "बंद", "ಆಫ್‌ಲೈನ್"],
  "live.banner": [
    "Live updates are off. What you see may be old.",
    "ताज़ा खबर बंद है। जो दिख रहा है वह पुराना हो सकता है।",
    "ತಾಜಾ ಸುದ್ದಿ ನಿಂತಿದೆ. ಕಾಣುತ್ತಿರುವುದು ಹಳೆಯದಾಗಿರಬಹುದು.",
  ],
  "live.retry": ["Reconnect", "फिर जोड़ें", "ಮತ್ತೆ ಸಂಪರ್ಕಿಸಿ"],
  "theme.dark": ["Use dark screen", "गहरी स्क्रीन", "ಗಾಢ ಪರದೆ"],
  "theme.light": ["Use light screen", "हल्की स्क्रीन", "ತಿಳಿ ಪರದೆ"],


  "boot.loading": ["Opening Sahay", "सहाय खुल रहा है", "ಸಹಾಯ್ ತೆರೆಯುತ್ತಿದೆ"],
  "boot.error": ["Could not reach Sahay", "सहाय से जुड़ नहीं पाए", "ಸಹಾಯ್ ಸಂಪರ್ಕವಾಗಲಿಲ್ಲ"],
  "retry": ["Try again", "फिर कोशिश करें", "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ"],
  "close": ["Close", "बंद करें", "ಮುಚ್ಚಿ"],
  "back": ["Back", "पीछे", "ಹಿಂದೆ"],
  "next": ["Next", "आगे", "ಮುಂದೆ"],
  "talkCta": ["Talk to Sahay", "सहाय से बात करें", "ಸಹಾಯ್ ಜೊತೆ ಮಾತನಾಡಿ"],

  "welcome.lang": ["Choose your language", "अपनी भाषा चुनें", "ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ"],
  "welcome.shop": ["Your shop's name", "आपकी दुकान का नाम", "ನಿಮ್ಮ ಅಂಗಡಿಯ ಹೆಸರು"],
  "welcome.city": ["Your city", "आपका शहर", "ನಿಮ್ಮ ನಗರ"],
  "welcome.code": ["Access code", "एक्सेस कोड", "ಪ್ರವೇಶ ಕೋಡ್"],
  "welcome.codeWhy": ["This Sahay needs a code to add a new shop.", "नई दुकान जोड़ने के लिए कोड चाहिए।", "ಹೊಸ ಅಂಗಡಿ ಸೇರಿಸಲು ಕೋಡ್ ಬೇಕು."],
  "welcome.step": ["Step {n} of {total}", "चरण {n} / {total}", "ಹಂತ {n} / {total}"],
  "welcome.ready": ["Sahay is ready for {shop}", "{shop} के लिए सहाय तैयार है", "{shop}ಗಾಗಿ ಸಹಾಯ್ ಸಿದ್ಧ"],
  "welcome.speak": ["Speak it", "बोलकर लिखें", "ಮಾತನಾಡಿ ಬರೆಯಿರಿ"],
  "welcome.listening": ["Listening, speak now", "सुन रहे हैं, बोलिए", "ಕೇಳುತ್ತಿದೆ, ಮಾತನಾಡಿ"],
  "welcome.saving": ["Saving", "सहेज रहे हैं", "ಉಳಿಸುತ್ತಿದೆ"],
  "welcome.done": ["Start", "शुरू करें", "ಪ್ರಾರಂಭಿಸಿ"],
  "err.nameEmpty": ["Write your shop's name", "दुकान का नाम लिखें", "ಅಂಗಡಿಯ ಹೆಸರು ಬರೆಯಿರಿ"],
  "err.cityEmpty": ["Write your city", "अपना शहर लिखें", "ನಿಮ್ಮ ನಗರ ಬರೆಯಿರಿ"],
  "err.chars": ["Use letters, numbers and spaces only", "सिर्फ़ अक्षर, अंक और खाली जगह", "ಅಕ್ಷರ, ಸಂಖ್ಯೆ ಮತ್ತು ಖಾಲಿ ಜಾಗ ಮಾತ್ರ"],
  "err.long": ["Keep it under 80 letters", "80 अक्षरों से छोटा रखें", "80 ಅಕ್ಷರಗಳಿಗಿಂತ ಕಡಿಮೆ ಇರಲಿ"],
  "err.codeEmpty": ["Write the access code", "एक्सेस कोड लिखें", "ಪ್ರವೇಶ ಕೋಡ್ ಬರೆಯಿರಿ"],
  "err.save": ["Could not save your shop", "दुकान सहेजी नहीं जा सकी", "ಅಂಗಡಿ ಉಳಿಸಲಾಗಲಿಲ್ಲ"],
  "err.network": ["Sahay's server did not answer. Check the internet and try again.", "सहाय का सर्वर जवाब नहीं दे रहा। इंटरनेट देखकर फिर कोशिश करें।", "ಸಹಾಯ್ ಸರ್ವರ್ ಉತ್ತರಿಸಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ನೋಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "err.limit": ["Too many tries. Wait a little and try again.", "बहुत बार कोशिश हुई। थोड़ी देर बाद करें।", "ಹೆಚ್ಚು ಪ್ರಯತ್ನಗಳು. ಸ್ವಲ್ಪ ಕಾಯಿರಿ."],
  "err.session": ["Your session ended. Reload the page.", "आपका सत्र खत्म हुआ। पेज फिर खोलें।", "ನಿಮ್ಮ ಸೆಷನ್ ಮುಗಿದಿದೆ. ಪುಟವನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ."],

  "talk.tap": ["Tap to talk", "बात करने के लिए छुएँ", "ಮಾತನಾಡಲು ಒತ್ತಿ"],
  "talk.mic": ["Allow the microphone", "माइक की अनुमति दें", "ಮೈಕ್‌ಗೆ ಅನುಮತಿ ನೀಡಿ"],
  "talk.connecting": ["Connecting", "जुड़ रहा है", "ಸಂಪರ್ಕಿಸುತ್ತಿದೆ"],
  "talk.saferRoute": ["Connecting through a safer route…", "सुरक्षित रास्ते से जुड़ रहा है…", "ಸುರಕ್ಷಿತ ಮಾರ್ಗದಲ್ಲಿ ಸಂಪರ್ಕಿಸುತ್ತಿದೆ…"],
  "talk.waiting": ["Sahay is joining", "सहाय जुड़ रही है", "ಸಹಾಯ್ ಸೇರುತ್ತಿದೆ"],
  "talk.listening": ["Listening", "सुन रही हूँ", "ಕೇಳುತ್ತಿದ್ದೇನೆ"],
  "talk.thinking": ["Thinking", "सोच रही हूँ", "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ"],
  "talk.speaking": ["Speaking", "बोल रही हूँ", "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ"],
  "talk.working": ["Working for you", "आपके लिए काम कर रही हूँ", "ನಿಮಗಾಗಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೇನೆ"],
  "talk.yourTurn": ["Your turn, speak", "अब आप बोलिए", "ಈಗ ನೀವು ಮಾತನಾಡಿ"],
  "talk.reconnecting": ["Reconnecting", "फिर जुड़ रहा है", "ಮತ್ತೆ ಸಂಪರ್ಕಿಸುತ್ತಿದೆ"],
  "talk.ending": ["Ending the call", "कॉल बंद हो रही है", "ಕರೆ ಮುಗಿಯುತ್ತಿದೆ"],
  "talk.end": ["End call", "कॉल बंद करें", "ಕರೆ ಮುಗಿಸಿ"],
  "talk.mute": ["Mute my microphone", "मेरा माइक बंद करें", "ನನ್ನ ಮೈಕ್ ಮ್ಯೂಟ್ ಮಾಡಿ"],
  "talk.unmute": ["Turn my microphone on", "मेरा माइक चालू करें", "ನನ್ನ ಮೈಕ್ ಆನ್ ಮಾಡಿ"],
  "talk.modeCall": ["Call", "कॉल", "ಕರೆ"],
  "talk.modeType": ["Type", "लिखें", "ಬರೆಯಿರಿ"],
  "talk.modeLabel": ["How to talk", "बात का तरीका", "ಮಾತಿನ ವಿಧಾನ"],
  "talk.typeSoon": ["Typing comes soon", "लिखना जल्द आएगा", "ಬರೆಯುವುದು ಶೀಘ್ರದಲ್ಲೇ"],
  "talk.typeBox": ["Message to Sahay", "सहाय को संदेश", "ಸಹಾಯ್‌ಗೆ ಸಂದೇಶ"],
  "talk.send": ["Send", "भेजें", "ಕಳುಹಿಸಿ"],
  "talk.sendFail": ["Message not sent. Try again.", "संदेश नहीं गया। फिर भेजें।", "ಸಂದೇಶ ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಕಳುಹಿಸಿ."],
  "talk.typedYes": ["Typed yes does not approve. Use the yes card.", "लिखी हुई हाँ मंज़ूरी नहीं है। हाँ वाला कार्ड दबाएँ।", "ಬರೆದ ಹೌದು ಒಪ್ಪಿಗೆಯಲ್ಲ. ಒಪ್ಪಿಗೆ ಕಾರ್ಡ್ ಒತ್ತಿ."],
  "talk.you": ["You", "आप", "ನೀವು"],
  "talk.sahay": ["Sahay", "सहाय", "ಸಹಾಯ್"],
  "talk.hint": ["Tap the circle and say what you need, how much, and your price.", "गोला छूकर बताइए क्या चाहिए, कितना, और कितने दाम तक।", "ವೃತ್ತ ಒತ್ತಿ, ಏನು ಬೇಕು, ಎಷ್ಟು, ಯಾವ ಬೆಲೆವರೆಗೆ ಹೇಳಿ."],
  "talk.teachHint": ["Tell me how you like to buy.", "बताइए आप कैसे खरीदना पसंद करते हैं।", "ನೀವು ಹೇಗೆ ಖರೀದಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ ಹೇಳಿ."],
  "talk.disclosure": [
    "Hi, I am Sahay, an automated assistant for {biz}.",
    "नमस्ते, मैं सहाय हूँ, {biz} का स्वचालित सहायक।",
    "ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, {biz} ಅವರ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ.",
  ],
  "talk.audioBlocked": ["Tap to hear Sahay", "सहाय को सुनने के लिए छुएँ", "ಸಹಾಯ್ ಕೇಳಲು ಒತ್ತಿ"],
  "talk.ended": ["The call ended. Tap the circle to talk again.", "कॉल खत्म हुई। फिर बात के लिए गोला छुएँ।", "ಕರೆ ಮುಗಿಯಿತು. ಮತ್ತೆ ಮಾತನಾಡಲು ವೃತ್ತ ಒತ್ತಿ."],
  "talk.otherTab": ["A call is still open, maybe in another tab.", "एक कॉल अभी खुली है, शायद दूसरी टैब में।", "ಒಂದು ಕರೆ ಇನ್ನೂ ತೆರೆದಿದೆ, ಬಹುಶಃ ಇನ್ನೊಂದು ಟ್ಯಾಬ್‌ನಲ್ಲಿ."],
  "yes.placing": ["Order is being made", "ऑर्डर बन रहा है…", "ಆರ್ಡರ್ ಆಗುತ್ತಿದೆ…"],
  "yes.placingSlow": ["The order is taking longer. Sahay will tell you, or check Buy.", "ऑर्डर में देर हो रही है। सहाय बताएगी, या खरीदें में देखें।", "ಆರ್ಡರ್ ತಡವಾಗುತ್ತಿದೆ. ಸಹಾಯ್ ತಿಳಿಸುತ್ತದೆ, ಅಥವಾ ಖರೀದಿಯಲ್ಲಿ ನೋಡಿ."],
  "talk.oldCall": ["Sahay is still holding your last call.", "सहाय आपकी पिछली कॉल अभी पकड़े हुए है।", "ಸಹಾಯ್ ನಿಮ್ಮ ಹಿಂದಿನ ಕರೆಯನ್ನು ಇನ್ನೂ ಹಿಡಿದಿದೆ."],
  "talk.otherScreen": ["A call is open on another screen.", "किसी दूसरी स्क्रीन पर एक कॉल खुली है।", "ಇನ್ನೊಂದು ಪರದೆಯಲ್ಲಿ ಒಂದು ಕರೆ ತೆರೆದಿದೆ."],
  "talk.endThat": ["End that call", "वह कॉल बंद करें", "ಆ ಕರೆ ಮುಗಿಸಿ"],
  "talk.interrupted": ["cut short", "बीच में रुका", "ಮಧ್ಯದಲ್ಲಿ ನಿಂತಿತು"],
  "talk.convo": ["Conversation", "बातचीत", "ಸಂಭಾಷಣೆ"],

  "now.idle": ["Ready when you are", "जब चाहें, मैं तैयार हूँ", "ನೀವು ಸಿದ್ಧವಾದಾಗ ನಾನು ಸಿದ್ಧ"],
  "now.heard": ["Got your need: {item}", "आपकी ज़रूरत समझी: {item}", "ನಿಮ್ಮ ಅಗತ್ಯ ತಿಳಿಯಿತು: {item}"],
  "now.searching": ["Finding sellers for {item}", "{item} के विक्रेता ढूँढ रही हूँ", "{item} ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ"],
  "now.found": ["Found {n} sellers for {item}", "{item} के {n} विक्रेता मिले", "{item}ಗೆ {n} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕರು"],
  // The same lines when the item is in another script than the screen's (item-line.js).
  "now.heardAny": ["Got your need", "आपकी ज़रूरत समझ ली", "ನಿಮ್ಮ ಅಗತ್ಯ ತಿಳಿಯಿತು"],
  "now.searchingAny": ["Finding sellers", "विक्रेता ढूँढ रही हूँ", "ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ"],
  "now.foundAny": ["Found {n} sellers", "{n} विक्रेता मिले", "{n} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕರು"],
  "now.bargaining": ["Bargaining with {vendor}", "{vendor} से मोलभाव कर रही हूँ", "{vendor} ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡುತ್ತಿದ್ದೇನೆ"],
  "now.waitingYes": ["Waiting for your yes", "आपकी हाँ का इंतज़ार है", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದ್ದೇನೆ"],
  "now.ordered": ["Order placed", "ऑर्डर हो गया", "ಆರ್ಡರ್ ಆಯಿತು"],
  "now.failed": ["Some work stopped. Ask Sahay to try again.", "कुछ काम रुक गया। सहाय से फिर कहिए।", "ಕೆಲವು ಕೆಲಸ ನಿಂತಿದೆ. ಸಹಾಯ್‌ಗೆ ಮತ್ತೆ ಹೇಳಿ."],

  "speak.label": ["Read aloud", "पढ़कर सुनाएँ", "ಓದಿ ಕೇಳಿಸಿ"],
  "speak.playing": ["Playing", "सुना रहे हैं", "ಕೇಳಿಸುತ್ತಿದೆ"],
  "speak.stop": ["Stop reading", "सुनाना बंद करें", "ಓದುವುದು ನಿಲ್ಲಿಸಿ"],
  "speak.notReady": ["Reading aloud is not ready on this server yet.", "इस सर्वर पर पढ़कर सुनाना अभी तैयार नहीं है।", "ಈ ಸರ್ವರ್‌ನಲ್ಲಿ ಓದಿ ಕೇಳಿಸುವುದು ಇನ್ನೂ ಸಿದ್ಧವಿಲ್ಲ."],
  "speak.limit": ["Read aloud many times already. Wait a few minutes.", "बहुत बार सुना चुके। कुछ मिनट रुकिए।", "ಈಗಾಗಲೇ ಹಲವು ಬಾರಿ ಓದಲಾಗಿದೆ. ಕೆಲವು ನಿಮಿಷ ಕಾಯಿರಿ."],
  "speak.failed": ["Could not read this aloud.", "यह पढ़कर नहीं सुना पाए।", "ಇದನ್ನು ಓದಿ ಕೇಳಿಸಲಾಗಲಿಲ್ಲ."],
  "speak.onCall": ["Sahay is saying it on the call.", "सहाय कॉल पर बोल रही है।", "ಸಹಾಯ್ ಕರೆಯಲ್ಲಿ ಹೇಳುತ್ತಿದೆ."],

  "empty.work.title": ["No work yet", "अभी कोई काम नहीं", "ಇನ್ನೂ ಯಾವುದೇ ಕೆಲಸವಿಲ್ಲ"],
  "empty.work.text": ["Tell Sahay what to buy. Every step shows up here.", "सहाय को बताइए क्या खरीदना है। हर कदम यहाँ दिखेगा।", "ಏನು ಖರೀದಿಸಬೇಕು ಸಹಾಯ್‌ಗೆ ಹೇಳಿ. ಪ್ರತಿ ಹೆಜ್ಜೆ ಇಲ್ಲಿ ಕಾಣುತ್ತದೆ."],
  "empty.orders.title": ["No orders yet", "अभी कोई ऑर्डर नहीं", "ಇನ್ನೂ ಯಾವುದೇ ಆರ್ಡರ್ ಇಲ್ಲ"],
  "empty.orders.text": ["After your yes, the order and its paper appear here.", "आपकी हाँ के बाद ऑर्डर और उसकी पर्ची यहाँ आएगी।", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರ ಆರ್ಡರ್ ಮತ್ತು ಅದರ ಚೀಟಿ ಇಲ್ಲಿ ಬರುತ್ತದೆ."],
  "empty.rules.title": ["Sahay is still learning you", "सहाय अभी आपको जान रही है", "ಸಹಾಯ್ ಇನ್ನೂ ನಿಮ್ಮನ್ನು ಅರಿಯುತ್ತಿದೆ"],
  "empty.rules.text": ["Teach a rule by talking, like: never pay more than 80 rupees for rice.", "बात करके नियम सिखाइए, जैसे: चावल के लिए 80 रुपये से ज़्यादा कभी नहीं।", "ಮಾತನಾಡಿ ನಿಯಮ ಕಲಿಸಿ, ಉದಾ: ಅಕ್ಕಿಗೆ 80 ರೂಪಾಯಿಗಿಂತ ಹೆಚ್ಚು ಎಂದಿಗೂ ಬೇಡ."],
  "empty.history.title": ["Nothing has happened yet", "अभी कुछ नहीं हुआ", "ಇನ್ನೂ ಏನೂ ಆಗಿಲ್ಲ"],
  "empty.history.text": ["Every step Sahay takes is written here with the time.", "सहाय का हर कदम समय के साथ यहाँ लिखा जाता है।", "ಸಹಾಯ್‌ನ ಪ್ರತಿ ಹೆಜ್ಜೆ ಸಮಯದೊಂದಿಗೆ ಇಲ್ಲಿ ಬರೆಯಲಾಗುತ್ತದೆ."],
  "loading": ["Loading", "आ रहा है", "ಬರುತ್ತಿದೆ"],

  "yes.title": ["Your yes?", "आपकी हाँ?", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ?"],
  "yes.approve": ["Yes", "हाँ", "ಹೌದು"],
  "yes.approveLong": ["Yes, place this order", "हाँ, यह ऑर्डर दें", "ಹೌದು, ಈ ಆರ್ಡರ್ ಮಾಡಿ"],
  "yes.reject": ["No", "नहीं", "ಬೇಡ"],
  "yes.rejectLong": ["No, do not buy", "नहीं, मत खरीदें", "ಬೇಡ, ಖರೀದಿಸಬೇಡಿ"],
  "yes.total": ["Total", "कुल", "ಒಟ್ಟು"],
  "yes.from": ["From", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "yes.delivery": ["Delivery in {n} days", "{n} दिन में डिलीवरी", "{n} ದಿನಗಳಲ್ಲಿ ವಿತರಣೆ"],
  "yes.saving": ["Saving your answer", "आपका जवाब सहेज रहे हैं", "ನಿಮ್ಮ ಉತ್ತರ ಉಳಿಸುತ್ತಿದೆ"],
  "yes.error": ["Your answer was not saved.", "आपका जवाब सहेजा नहीं गया।", "ನಿಮ್ಮ ಉತ್ತರ ಉಳಿಸಲಾಗಲಿಲ್ಲ."],
  "yes.gone": ["This was already answered.", "इसका जवाब पहले ही हो चुका है।", "ಇದಕ್ಕೆ ಈಗಾಗಲೇ ಉತ್ತರಿಸಲಾಗಿದೆ."],
  "yes.later": ["Later", "बाद में", "ನಂತರ"],
  "yes.pending": ["{n} waiting for your yes", "{n} आपकी हाँ के इंतज़ार में", "{n} ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿವೆ"],
  "simulated": ["simulated vendor", "सिम्युलेटेड विक्रेता (simulated vendor)", "ಸಿಮ್ಯುಲೇಟೆಡ್ ಮಾರಾಟಗಾರ (simulated vendor)"],

  "st.heard": ["Heard you", "सुन लिया", "ಕೇಳಿಸಿಕೊಂಡೆ"],
  "st.search": ["Searching", "ढूँढना", "ಹುಡುಕಾಟ"],
  "st.bargain": ["Bargaining", "मोलभाव", "ಚೌಕಾಸಿ"],
  "st.yes": ["Your yes", "आपकी हाँ", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ"],
  "st.ordered": ["Ordered", "ऑर्डर", "ಆರ್ಡರ್"],
  "st.paid": ["Paid", "भुगतान", "ಪಾವತಿ"],
  "st.reminder": ["Reminder", "याद", "ಜ್ಞಾಪನೆ"],
  "st.done": ["done", "हो गया", "ಆಯಿತು"],
  "st.active": ["now", "अभी", "ಈಗ"],
  "st.needsYou": ["needs you", "आपकी ज़रूरत", "ನಿಮ್ಮ ಅಗತ್ಯ"],
  "st.upcoming": ["next", "आगे", "ಮುಂದೆ"],
  "st.failed": ["stopped", "रुक गया", "ನಿಂತಿದೆ"],
  "work.title": ["Work", "काम", "ಕೆಲಸ"],
  "work.sellers": ["{n} sellers", "{n} विक्रेता", "{n} ಮಾರಾಟಗಾರರು"],
  "work.upTo": ["up to {p}", "{p} तक", "{p} ವರೆಗೆ"],
  "work.listen": ["Listen in", "सुनिए", "ಕೇಳಿ"],
  "work.listening": ["Listening in", "सुन रहे हैं", "ಕೇಳುತ್ತಿದ್ದೀರಿ"],
  "work.stopListen": ["Stop listening", "सुनना बंद करें", "ಕೇಳುವುದು ನಿಲ್ಲಿಸಿ"],
  "work.listenFail": ["Could not listen in.", "सुन नहीं पाए।", "ಕೇಳಲಾಗಲಿಲ್ಲ."],
  "work.earlier": ["Earlier needs", "पिछली ज़रूरतें", "ಹಿಂದಿನ ಅಗತ್ಯಗಳು"],
  "work.stations": ["Steps for this need", "इस ज़रूरत के कदम", "ಈ ಅಗತ್ಯದ ಹೆಜ್ಜೆಗಳು"],
  "work.noSellers": ["No sellers found yet", "अभी कोई विक्रेता नहीं मिला", "ಇನ್ನೂ ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿಲ್ಲ"],
  "work.open": ["Open seller page", "विक्रेता का पेज खोलें", "ಮಾರಾಟಗಾರರ ಪುಟ ತೆರೆಯಿರಿ"],
  "work.when": ["by {d}", "{d} तक", "{d} ಒಳಗೆ"],
  "ladder.title": ["Price talk", "दाम की बात", "ಬೆಲೆ ಮಾತು"],
  "ladder.asks": ["Seller asks", "विक्रेता का दाम", "ಮಾರಾಟಗಾರರ ಬೆಲೆ"],
  "ladder.offers": ["Sahay offers", "सहाय का दाम", "ಸಹಾಯ್ ನೀಡಿದ ಬೆಲೆ"],
  "ladder.agreed": ["Agreed {p}", "{p} पर तय", "{p}ಕ್ಕೆ ಒಪ್ಪಿತು"],
  "ladder.noDeal": ["No deal", "सौदा नहीं हुआ", "ವ್ಯವಹಾರ ಆಗಲಿಲ್ಲ"],
  "ladder.empty": ["Prices appear here as they talk", "बात होते ही दाम यहाँ दिखेंगे", "ಮಾತು ನಡೆದಂತೆ ಬೆಲೆಗಳು ಇಲ್ಲಿ ಕಾಣುತ್ತವೆ"],
  "per": ["per {u}", "प्रति {u}", "ಪ್ರತಿ {u}"],

  "orders.title": ["Orders", "ऑर्डर", "ಆರ್ಡರ್"],
  "orders.paper": ["Order paper", "ऑर्डर पर्ची", "ಆರ್ಡರ್ ಚೀಟಿ"],
  "orders.pay": ["Pay", "भुगतान करें", "ಪಾವತಿಸಿ"],
  "orders.paid": ["Paid", "भुगतान हो गया", "ಪಾವತಿ ಆಗಿದೆ"],
  "orders.unpaid": ["Not paid", "भुगतान बाकी", "ಪಾವತಿ ಬಾಕಿ"],
  "orders.noLink": ["Payment link not made yet", "भुगतान लिंक अभी नहीं बना", "ಪಾವತಿ ಲಿಂಕ್ ಇನ್ನೂ ಆಗಿಲ್ಲ"],
  "orders.next": ["Next reminder", "अगली याद", "ಮುಂದಿನ ಜ್ಞಾಪನೆ"],
  "orders.sent": ["Reminder sent", "याद भेजी गई", "ಜ್ಞಾಪನೆ ಕಳುಹಿಸಲಾಗಿದೆ"],
  "orders.rem.payment_due": ["Payment", "भुगतान", "ಪಾವತಿ"],
  "orders.rem.delivery_check": ["Delivery", "डिलीवरी", "ವಿತರಣೆ"],
  "orders.telegram": ["Get updates on Telegram", "टेलीग्राम पर खबर पाएँ", "ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ ಸುದ್ದಿ ಪಡೆಯಿರಿ"],
  "orders.telegramOn": ["Telegram updates are on", "टेलीग्राम पर खबर चालू है", "ಟೆಲಿಗ್ರಾಮ್ ಸುದ್ದಿ ಆನ್ ಆಗಿದೆ"],
  "orders.telegramOff": ["Telegram is not set up on this server.", "इस सर्वर पर टेलीग्राम चालू नहीं है।", "ಈ ಸರ್ವರ್‌ನಲ್ಲಿ ಟೆಲಿಗ್ರಾಮ್ ಇಲ್ಲ."],
  "orders.telegramPress": ["Press Start in Telegram to finish.", "टेलीग्राम में Start दबाइए।", "ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ Start ಒತ್ತಿ."],
  "orders.openTelegram": ["Open Telegram", "टेलीग्राम खोलें", "ಟೆಲಿಗ್ರಾಮ್ ತೆರೆಯಿರಿ"],
  "orders.status.confirmed": ["Confirmed", "पक्का", "ಖಚಿತ"],
  "orders.status.paid": ["Paid", "भुगतान हुआ", "ಪಾವತಿ ಆಯಿತು"],
  "orders.status.in_transit": ["On the way", "रास्ते में", "ದಾರಿಯಲ್ಲಿ"],
  "orders.status.delivered": ["Delivered", "पहुँच गया", "ತಲುಪಿದೆ"],
  "orders.status.closed": ["Closed", "बंद", "ಮುಚ್ಚಲಾಗಿದೆ"],
  "orders.status.cancelled": ["Cancelled", "रद्द", "ರದ್ದು"],

  "me.title": ["My Sahay", "मेरा सहाय", "ನನ್ನ ಸಹಾಯ್"],
  "me.speed": ["Speaking speed", "बोलने की रफ़्तार", "ಮಾತಿನ ವೇಗ"],
  "me.speed.slow": ["Slow", "धीमे", "ನಿಧಾನ"],
  "me.speed.normal": ["Normal", "सामान्य", "ಸಾಮಾನ್ಯ"],
  "me.style": ["Bargaining", "मोलभाव", "ಚೌಕಾಸಿ"],
  "me.style.gentle": ["Gentle", "नरम", "ಮೃದು"],
  "me.style.balanced": ["Balanced", "संतुलित", "ಸಮತೋಲನ"],
  "me.style.tough": ["Tough", "सख़्त", "ಕಠಿಣ"],
  "me.language": ["Language", "भाषा", "ಭಾಷೆ"],
  "me.teach": ["Teach me", "मुझे सिखाइए", "ನನಗೆ ಕಲಿಸಿ"],
  "me.history": ["History", "इतिहास", "ಇತಿಹಾಸ"],
  "me.keep": ["Keep", "रखें", "ಇರಲಿ"],
  "me.forget": ["Forget", "भूलें", "ಮರೆತುಬಿಡಿ"],
  "me.why": ["Why", "क्यों", "ಏಕೆ"],
  "me.suggested": ["New idea", "नया सुझाव", "ಹೊಸ ಸಲಹೆ"],
  "me.rule": ["Rule", "नियम", "ನಿಯಮ"],
  "me.off": ["Off", "बंद", "ಆಫ್"],
  "me.memory": ["Remembers", "याद है", "ನೆನಪಿದೆ"],
  "me.notReady": ["My Sahay is not ready on this server yet.", "इस सर्वर पर मेरा सहाय अभी तैयार नहीं है।", "ಈ ಸರ್ವರ್‌ನಲ್ಲಿ ನನ್ನ ಸಹಾಯ್ ಇನ್ನೂ ಸಿದ್ಧವಿಲ್ಲ."],
  "me.loadFail": ["Could not load My Sahay.", "मेरा सहाय खुल नहीं पाया।", "ನನ್ನ ಸಹಾಯ್ ತೆರೆಯಲಾಗಲಿಲ್ಲ."],
  "me.saveFail": ["Not saved. Try again.", "सहेजा नहीं गया। फिर कोशिश करें।", "ಉಳಿಸಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "me.saved": ["Saved", "सहेज लिया", "ಉಳಿಸಲಾಗಿದೆ"],
  "me.rulesTitle": ["Rules and memory", "नियम और याद", "ನಿಯಮಗಳು ಮತ್ತು ನೆನಪು"],
  "me.voiceSays": ["Only your spoken yes or the green yes button keeps a rule.", "नियम सिर्फ़ आपकी बोली हुई हाँ या हरे हाँ बटन से रखा जाता है।", "ನಿಮ್ಮ ಮಾತಿನ ಹೌದು ಅಥವಾ ಹಸಿರು ಹೌದು ಬಟನ್ ಮಾತ್ರ ನಿಯಮ ಉಳಿಸುತ್ತದೆ."],

  "hist.title": ["History", "इतिहास", "ಇತಿಹಾಸ"],
  "hist.requirement.saved": ["Heard your need", "आपकी ज़रूरत सुनी", "ನಿಮ್ಮ ಅಗತ್ಯ ಕೇಳಿತು"],
  "hist.requirement.dismissed": ["You removed a need", "आपने एक ज़रूरत हटाई", "ನೀವು ಒಂದು ಅಗತ್ಯ ತೆಗೆದಿರಿ"],
  "hist.job.started": ["Started work", "काम शुरू किया", "ಕೆಲಸ ಪ್ರಾರಂಭಿಸಿತು"],
  "hist.job.done": ["Finished work", "काम पूरा किया", "ಕೆಲಸ ಮುಗಿಸಿತು"],
  "hist.job.failed": ["Work stopped", "काम रुक गया", "ಕೆಲಸ ನಿಂತಿತು"],
  "hist.vendor.found": ["Found a seller", "विक्रेता मिला", "ಮಾರಾಟಗಾರ ಸಿಕ್ಕರು"],
  "hist.negotiation.ended": ["Price talk ended", "दाम की बात खत्म", "ಬೆಲೆ ಮಾತು ಮುಗಿಯಿತು"],
  "hist.quote.recorded": ["Got a price", "दाम मिला", "ಬೆಲೆ ಸಿಕ್ಕಿತು"],
  "hist.approval.requested": ["Asked for your yes", "आपकी हाँ माँगी", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಕೇಳಿತು"],
  "hist.approval.yes": ["You said yes", "आपने हाँ कहा", "ನೀವು ಹೌದು ಎಂದಿರಿ"],
  "hist.approval.no": ["You said no", "आपने ना कहा", "ನೀವು ಬೇಡ ಎಂದಿರಿ"],
  "hist.order.created": ["Order placed", "ऑर्डर दिया", "ಆರ್ಡರ್ ಮಾಡಿತು"],
  "hist.payment.link": ["Payment link ready", "भुगतान लिंक तैयार", "ಪಾವತಿ ಲಿಂಕ್ ಸಿದ್ಧ"],
  "hist.followup.fired": ["Reminder sent", "याद भेजी", "ಜ್ಞಾಪನೆ ಕಳುಹಿಸಿತು"],
  "hist.session.started": ["Call started", "कॉल शुरू", "ಕರೆ ಪ್ರಾರಂಭ"],
  "hist.session.ended": ["Call ended", "कॉल खत्म", "ಕರೆ ಮುಗಿಯಿತು"],
  "hist.telegram.linked": ["Telegram linked", "टेलीग्राम जुड़ा", "ಟೆಲಿಗ್ರಾಮ್ ಸಂಪರ್ಕವಾಯಿತು"],
  "hist.rule.decided": ["Rule decided", "नियम तय", "ನಿಯಮ ನಿರ್ಧಾರ"],
  "hist.rule.suggested": ["New rule idea", "नए नियम का सुझाव", "ಹೊಸ ನಿಯಮದ ಸಲಹೆ"],
  "hist.error": ["A problem happened", "कोई दिक्कत आई", "ಏನೋ ತೊಂದರೆ ಆಯಿತು"],
  "hist.byVoice": ["by voice", "बोलकर", "ಮಾತಿನಿಂದ"],
  "hist.byButton": ["by button", "बटन से", "ಬಟನ್‌ನಿಂದ"],

  "call.mic_denied": ["The microphone is blocked. Allow it in the browser bar, then tap again.", "माइक बंद है। ब्राउज़र में अनुमति दें, फिर छुएँ।", "ಮೈಕ್ ತಡೆಯಲಾಗಿದೆ. ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಅನುಮತಿಸಿ, ಮತ್ತೆ ಒತ್ತಿ."],
  "call.mic_busy": ["Another app is using the microphone.", "माइक किसी और ऐप में चल रहा है।", "ಮೈಕ್ ಬೇರೆ ಆ್ಯಪ್ ಬಳಸುತ್ತಿದೆ."],
  "call.mic_missing": ["No microphone found.", "कोई माइक नहीं मिला।", "ಮೈಕ್ ಸಿಗಲಿಲ್ಲ."],
  "call.dropped": ["The call dropped. Tap to call again.", "कॉल कट गई। फिर कॉल के लिए छुएँ।", "ಕರೆ ಕಡಿತವಾಯಿತು. ಮತ್ತೆ ಕರೆಗೆ ಒತ್ತಿ."],
  "call.failed": ["The call could not start.", "कॉल शुरू नहीं हो सकी।", "ಕರೆ ಪ್ರಾರಂಭವಾಗಲಿಲ್ಲ."],
  "call.network_blocked": ["This network blocks calls. Try another Wi-Fi or a phone hotspot.", "यह नेटवर्क कॉल रोक रहा है। दूसरा वाई-फ़ाई या फ़ोन हॉटस्पॉट आज़माएँ।", "ಈ ನೆಟ್‌ವರ್ಕ್ ಕರೆಗಳನ್ನು ತಡೆಯುತ್ತಿದೆ. ಬೇರೆ ವೈ-ಫೈ ಅಥವಾ ಫೋನ್ ಹಾಟ್‌ಸ್ಪಾಟ್ ಬಳಸಿ."],
  "call.proxy_unavailable": ["The safer route is not available on this network. Try another Wi-Fi or a phone hotspot.", "सुरक्षित रास्ता अभी उपलब्ध नहीं है। दूसरा वाई-फ़ाई या फ़ोन हॉटस्पॉट आज़माएँ।", "ಸುರಕ್ಷಿತ ಮಾರ್ಗ ಈಗ ಲಭ್ಯವಿಲ್ಲ. ಬೇರೆ ವೈ-ಫೈ ಅಥವಾ ಫೋನ್ ಹಾಟ್‌ಸ್ಪಾಟ್ ಬಳಸಿ."],
  "call.offline": ["This device lost the internet.", "इंटरनेट चला गया।", "ಇಂಟರ್ನೆಟ್ ಹೋಯಿತು."],
  "call.stuck": ["The call stopped answering.", "कॉल ने जवाब देना बंद कर दिया।", "ಕರೆ ಉತ್ತರಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿತು."],
  "talk.callEnded": ["Call ended. Tap to call again.", "कॉल बंद हो गई। फिर से कॉल के लिए छुएँ।", "ಕರೆ ಮುಗಿಯಿತು. ಮತ್ತೆ ಕರೆಗೆ ಒತ್ತಿ."],
  "talk.earlier": ["Earlier ({n})", "पहले की बातें ({n})", "ಹಿಂದಿನ ಮಾತುಗಳು ({n})"],
  "talk.earlierHide": ["Hide earlier", "पहले की बातें छिपाएँ", "ಹಿಂದಿನ ಮಾತು ಮುಚ್ಚಿ"],

  "work.dismiss": ["Remove {item}", "{item} हटाएँ", "{item} ತೆಗೆಯಿರಿ"],
  "work.dismissAsk": ["Remove?", "हटाएँ?", "ತೆಗೆಯಬೇಕೆ?"],
  "work.dismissWhy": ["Sahay will forget this need. Nothing was bought for it.", "सहाय यह ज़रूरत भूल जाएगी। इसके लिए कुछ नहीं खरीदा गया।", "ಸಹಾಯ್ ಈ ಅಗತ್ಯವನ್ನು ಮರೆಯುತ್ತದೆ. ಇದಕ್ಕಾಗಿ ಏನನ್ನೂ ಖರೀದಿಸಿಲ್ಲ."],
  "work.dismissYes": ["Remove", "हटाएँ", "ತೆಗೆಯಿರಿ"],
  "work.dismissNo": ["Keep", "रहने दें", "ಇರಲಿ"],
  "work.dismissBusy": ["Sahay is still working on this need, so it stays.", "सहाय अभी इस ज़रूरत पर काम कर रही है, यह रहेगी।", "ಸಹಾಯ್ ಇನ್ನೂ ಈ ಅಗತ್ಯದ ಮೇಲೆ ಕೆಲಸ ಮಾಡುತ್ತಿದೆ, ಇದು ಇರುತ್ತದೆ."],
  "work.dismissOrdered": ["This need already has an order, so it stays.", "इस ज़रूरत का ऑर्डर बन चुका है, यह रहेगी।", "ಈ ಅಗತ್ಯಕ್ಕೆ ಆರ್ಡರ್ ಆಗಿದೆ, ಇದು ಇರುತ್ತದೆ."],
  "work.dismissFail": ["Could not remove it. Try again.", "हटा नहीं पाए। फिर कोशिश करें।", "ತೆಗೆಯಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
};

/* Units as stored (canonical codes from src/procurement/units.js) in the owner's script. */
const UNITS = {
  kg: ["kg", "किलो", "ಕಿಲೋ"],
  g: ["g", "ग्राम", "ಗ್ರಾಂ"],
  quintal: ["quintal", "क्विंटल", "ಕ್ವಿಂಟಾಲ್"],
  tonne: ["tonne", "टन", "ಟನ್"],
  litre: ["litre", "लीटर", "ಲೀಟರ್"],
  ml: ["ml", "मिलीलीटर", "ಮಿಲಿಲೀಟರ್"],
  metre: ["metre", "मीटर", "ಮೀಟರ್"],
  piece: ["piece", "पीस", "ಪೀಸ್"],
  bag: ["bag", "बोरी", "ಚೀಲ"],
  box: ["box", "डिब्बा", "ಬಾಕ್ಸ್"],
  pack: ["pack", "पैक", "ಪ್ಯಾಕ್"],
  packet: ["packet", "पैकेट", "ಪ್ಯಾಕೆಟ್"],
  dozen: ["dozen", "दर्जन", "ಡಜನ್"],
};

/* Common cities in the owner's script; any other city is shown as it was stored. */
const CITIES = [
  [["Bengaluru", "बेंगलुरु", "ಬೆಂಗಳೂರು"], ["bangalore", "bengaluru city", "बैंगलोर", "बंगलौर", "बेंगलूरु"]],
  [["Mumbai", "मुंबई", "ಮುಂಬೈ"], ["bombay", "मुम्बई"]],
  [["New Delhi", "नई दिल्ली", "ನವದೆಹಲಿ"], ["new-delhi"]],
  [["Delhi", "दिल्ली", "ದೆಹಲಿ"], ["दिल्ली एनसीआर"]],
  [["Chennai", "चेन्नई", "ಚೆನ್ನೈ"], ["madras"]],
  [["Hyderabad", "हैदराबाद", "ಹೈದರಾಬಾದ್"], []],
  [["Pune", "पुणे", "ಪುಣೆ"], ["poona"]],
  [["Kolkata", "कोलकाता", "ಕೋಲ್ಕತ್ತಾ"], ["calcutta"]],
  [["Mysuru", "मैसूरु", "ಮೈಸೂರು"], ["mysore", "मैसूर"]],
  [["Ahmedabad", "अहमदाबाद", "ಅಹಮದಾಬಾದ್"], []],
  [["Jaipur", "जयपुर", "ಜೈಪುರ"], []],
  [["Lucknow", "लखनऊ", "ಲಕ್ನೋ"], []],
  [["Hubballi", "हुबली", "ಹುಬ್ಬಳ್ಳಿ"], ["hubli"]],
  [["Mangaluru", "मंगलुरु", "ಮಂಗಳೂರು"], ["mangalore"]],
];
const CITY_INDEX = new Map();
for (const [names, extra] of CITIES) for (const n of [...names, ...extra]) CITY_INDEX.set(n.toLowerCase(), names);

const IDX = { en: 0, hi: 1, kn: 2 };
const LISTENERS = new Set();
let current = "en";

export const LANGS = [
  { code: "hi-IN", short: "hi", native: "हिन्दी" },
  { code: "kn-IN", short: "kn", native: "ಕನ್ನಡ" },
  { code: "en-IN", short: "en", native: "English" },
];

export function shortLang(code) {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("hi")) return "hi";
  if (c.startsWith("kn")) return "kn";
  return "en";
}

export function lang() { return current; }

export function setLang(code) {
  const next = shortLang(code);
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  for (const fn of LISTENERS) fn(next);
}

export function onLang(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }

/** t(key, vars) in the current language; missing translations fall back to English. */
export function t(key, vars, inLang = current) {
  const row = T[key];
  let s = row ? (row[IDX[inLang]] || row[0]) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
  return s;
}

/** A stored unit code ("kg") in the owner's script (किलो, ಕಿಲೋ); an unknown unit as stored. */
export function unitWord(u, inLang = current) {
  if (u === null || u === undefined || u === "") return "";
  const row = UNITS[String(u).trim().toLowerCase()];
  return row ? row[IDX[inLang]] : String(u);
}

/** A stored city ("Bengaluru", "bangalore") in the owner's script; an unknown city as stored. */
export function cityWord(city, inLang = current) {
  if (city === null || city === undefined) return "";
  const text = String(city).trim();
  const [head, ...rest] = text.split(",");
  const names = CITY_INDEX.get(head.trim().toLowerCase());
  if (!names) return text;
  return [names[IDX[inLang]], ...rest.map((r) => r.trim())].filter(Boolean).join(", ");
}

export function has(key) { return Object.prototype.hasOwnProperty.call(T, key); }

/**
 * Screen modules register their own strings: addStrings({ "sell.title": [en, hi, kn] }).
 * Native script only (Devanagari, Kannada). A key that already exists is not overwritten, so two
 * modules can never silently change each other's words.
 */
export function addStrings(rows) {
  for (const [k, v] of Object.entries(rows || {})) {
    if (Object.prototype.hasOwnProperty.call(T, k)) { console.warn(`i18n: duplicate key ${k}`); continue; }
    if (Array.isArray(v) && v.length === 3) T[k] = v;
  }
}

/** Dates for the owner, in their language. */
export function when(d, opts = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) {
  if (!d) return "";
  const loc = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" }[current];
  try { return d.toLocaleString(loc, opts); } catch { return d.toLocaleString("en-IN", opts); }
}
