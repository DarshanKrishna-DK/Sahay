// Home words (home.js, home-model.js), registered with i18n.addStrings. English first, then Hindi
// in Devanagari and Kannada in Kannada script; short everyday words. Checked by
// test/home-model.test.js (every key used has all three, in native script).

import { addStrings } from "./i18n.js";

addStrings({
  // Greeting (time of day) and the state word next to the figure.
  "home.greet.morning": ["Good morning", "सुप्रभात", "ಶುಭೋದಯ"],
  "home.greet.afternoon": ["Good afternoon", "नमस्ते", "ಶುಭ ಮಧ್ಯಾಹ್ನ"],
  "home.greet.evening": ["Good evening", "शुभ संध्या", "ಶುಭ ಸಂಜೆ"],
  "home.figure": ["Sahay, your voice assistant", "सहाय, आपकी आवाज़ वाली सहायक", "ಸಹಾಯ್, ನಿಮ್ಮ ಧ್ವನಿ ಸಹಾಯಕ"],
  "home.assistant": ["Sahay is an automated assistant.", "सहाय एक स्वचालित सहायक है।", "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ."],
  "home.state.ready": ["Ready", "तैयार", "ಸಿದ್ಧ"],
  "home.state.listening": ["Listening", "सुन रही है", "ಕೇಳುತ್ತಿದೆ"],
  "home.state.yourTurn": ["Your turn", "आपकी बारी", "ನಿಮ್ಮ ಸರದಿ"],
  "home.state.thinking": ["Thinking", "सोच रही है", "ಯೋಚಿಸುತ್ತಿದೆ"],
  "home.state.speaking": ["Speaking", "बोल रही है", "ಮಾತಾಡುತ್ತಿದೆ"],
  "home.state.muted": ["Your mic is off", "आपका माइक बंद है", "ನಿಮ್ಮ ಮೈಕ್ ಆಫ್"],
  "home.state.joining": ["Sahay is joining", "सहाय जुड़ रही है", "ಸಹಾಯ್ ಸೇರುತ್ತಿದೆ"],
  "home.state.mic": ["Allow the microphone", "माइक की अनुमति दें", "ಮೈಕ್‌ಗೆ ಅನುಮತಿ ನೀಡಿ"],
  "home.state.connecting": ["Connecting", "जुड़ रही है", "ಸಂಪರ್ಕಿಸುತ್ತಿದೆ"],
  "home.state.safer": ["Connecting by a safer route", "सुरक्षित रास्ते से जुड़ रही है", "ಸುರಕ್ಷಿತ ಮಾರ್ಗದಲ್ಲಿ ಸಂಪರ್ಕ"],
  "home.state.reconnecting": ["Joining again", "फिर जुड़ रही है", "ಮತ್ತೆ ಸೇರುತ್ತಿದೆ"],
  "home.state.ending": ["Ending the call", "कॉल बंद हो रही है", "ಕರೆ ಮುಗಿಯುತ್ತಿದೆ"],
  "home.state.offline": ["No internet", "इंटरनेट नहीं है", "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ"],
  "home.state.trouble": ["Voice could not connect", "आवाज़ नहीं जुड़ पाई", "ಧ್ವನಿ ಸಂಪರ್ಕವಾಗಲಿಲ್ಲ"],
  "home.state.micBlocked": ["Microphone is blocked", "माइक रुका हुआ है", "ಮೈಕ್ ತಡೆಯಲಾಗಿದೆ"],
  "home.state.dropped": ["Call dropped", "कॉल कट गई", "ಕರೆ ಕಡಿತವಾಯಿತು"],
  "home.state.ended": ["Call ended", "कॉल बंद हुई", "ಕರೆ ಮುಗಿಯಿತು"],
  "home.state.waitingYes": ["Waiting for your yes", "आपकी हाँ का इंतज़ार", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ"],

  // The figure's spoken name for each call state (aria-label of the figure).
  "home.orb.first": ["Tap Talk to Sahay and say what you need", "सहाय से बोलें दबाइए और बताइए क्या चाहिए", "ಸಹಾಯ್ ಜೊತೆ ಮಾತಾಡಿ ಒತ್ತಿ, ಏನು ಬೇಕು ಹೇಳಿ"],
  "home.orb.offline": ["No internet", "इंटरनेट नहीं है", "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ"],
  "home.orb.blocked": ["Voice could not connect", "आवाज़ नहीं जुड़ पाई", "ಧ್ವನಿ ಸಂಪರ್ಕವಾಗಲಿಲ್ಲ"],
  "home.orb.micBlocked": ["Microphone is off", "माइक बंद है", "ಮೈಕ್ ಆಫ್ ಆಗಿದೆ"],
  "home.orb.failed": ["Could not connect", "जुड़ नहीं पाई", "ಸಂಪರ್ಕವಾಗಲಿಲ್ಲ"],
  "home.orb.reconnecting": ["Joining again", "फिर जुड़ रही है", "ಮತ್ತೆ ಸೇರುತ್ತಿದೆ"],
  "home.orb.muted": ["Your mic is off", "आपका माइक बंद है", "ನಿಮ್ಮ ಮೈಕ್ ಆಫ್ ಆಗಿದೆ"],
  "home.orb.typeTurn": ["Type your message", "अपना संदेश लिखिए", "ನಿಮ್ಮ ಸಂದೇಶ ಬರೆಯಿರಿ"],
  "home.orb.dropped": ["Call dropped", "कॉल कट गई", "ಕರೆ ಕಡಿತವಾಯಿತು"],
  "home.orb.ended": ["Call ended", "कॉल बंद हुई", "ಕರೆ ಮುಗಿಯಿತು"],

  // Talk / call controls.
  "home.talkToSahay": ["Talk to Sahay", "सहाय से बोलें", "ಸಹಾಯ್ ಜೊತೆ ಮಾತಾಡಿ"],
  "home.start": ["Talk to Sahay", "सहाय से बोलें", "ಸಹಾಯ್ ಜೊತೆ ಮಾತಾಡಿ"],
  "home.typeInstead": ["Type instead", "लिखकर बताइए", "ಬರೆದು ತಿಳಿಸಿ"],
  "home.typeClose": ["Close typing", "लिखना बंद करें", "ಬರೆಯುವುದು ಮುಚ್ಚಿ"],
  "home.controls": ["Call controls", "कॉल के बटन", "ಕರೆ ಬಟನ್‌ಗಳು"],
  "home.mute": ["Mute", "माइक बंद", "ಮ್ಯೂಟ್"],
  "home.unmute": ["Mic on", "माइक चालू", "ಮೈಕ್ ಆನ್"],
  "home.muteLong": ["Mute my microphone", "मेरा माइक बंद करें", "ನನ್ನ ಮೈಕ್ ಮ್ಯೂಟ್ ಮಾಡಿ"],
  "home.unmuteLong": ["Turn my microphone on", "मेरा माइक चालू करें", "ನನ್ನ ಮೈಕ್ ಆನ್ ಮಾಡಿ"],
  "home.talkToo": ["Speak", "बोलें", "ಮಾತಾಡಿ"],
  "home.end": ["End", "बंद करें", "ಮುಗಿಸಿ"],
  "home.endLong": ["End the call", "कॉल बंद करें", "ಕರೆ ಮುಗಿಸಿ"],
  "home.cancel": ["Cancel", "रोकें", "ನಿಲ್ಲಿಸಿ"],
  "home.callAgain": ["Call again", "फिर से जोड़ें", "ಮತ್ತೆ ಕರೆ ಮಾಡಿ"],
  "home.useButtons": ["Use buttons", "बटन से करें", "ಬಟನ್‌ನಿಂದ ಮಾಡಿ"],

  // Recovery notes (F8).
  "home.blockedTitle": ["Voice could not connect", "आवाज़ नहीं जुड़ पाई", "ಧ್ವನಿ ಸಂಪರ್ಕವಾಗಲಿಲ್ಲ"],
  "home.micTitle": ["Sahay cannot hear you", "सहाय आपको सुन नहीं पा रही", "ಸಹಾಯ್‌ಗೆ ನಿಮ್ಮ ಮಾತು ಕೇಳುತ್ತಿಲ್ಲ"],
  "home.failedText": ["Try again. Your yes still works with the Check button.", "फिर कोशिश करें। देखें बटन से हाँ अब भी हो सकती है।", "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. ನೋಡಿ ಬಟನ್‌ನಿಂದ ಒಪ್ಪಿಗೆ ಈಗಲೂ ಸಾಧ್ಯ."],
  "home.droppedTitle": ["Call dropped", "कॉल कट गई", "ಕರೆ ಕಡಿತವಾಯಿತು"],
  "home.droppedText": ["The line broke. Call again to carry on.", "लाइन टूट गई। आगे बात के लिए फिर से जोड़ें।", "ಸಂಪರ್ಕ ತುಂಡಾಯಿತು. ಮುಂದುವರಿಸಲು ಮತ್ತೆ ಕರೆ ಮಾಡಿ."],
  "home.endedTitle": ["Call ended", "कॉल बंद हुई", "ಕರೆ ಮುಗಿಯಿತು"],
  "home.endedText": ["Sahay closed the call. Call again any time.", "सहाय ने कॉल बंद की। जब चाहें फिर से जोड़ें।", "ಸಹಾಯ್ ಕರೆ ಮುಗಿಸಿತು. ಯಾವಾಗ ಬೇಕಾದರೂ ಮತ್ತೆ ಕರೆ ಮಾಡಿ."],
  "home.endedLimit": ["The call reached its time limit.", "कॉल का समय पूरा हुआ।", "ಕರೆಯ ಸಮಯ ಮುಗಿಯಿತು."],
  "home.workRunning": ["Your work is still running", "आपका काम चल रहा है", "ನಿಮ್ಮ ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ"],
  "home.offlineTitle": ["No internet", "इंटरनेट नहीं है", "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ"],
  "home.offlineText": ["Your work is safe. Sahay picks up when the internet is back.", "आपका काम सुरक्षित है। इंटरनेट आते ही सहाय आगे बढ़ेगी।", "ನಿಮ್ಮ ಕೆಲಸ ಸುರಕ್ಷಿತ. ಇಂಟರ್ನೆಟ್ ಬಂದ ತಕ್ಷಣ ಸಹಾಯ್ ಮುಂದುವರಿಯುತ್ತದೆ."],
  "home.issue.mic": ["Microphone trouble. Check it, or type.", "माइक में दिक्कत है। देखिए, या लिखकर बताइए।", "ಮೈಕ್ ತೊಂದರೆ. ಪರಿಶೀಲಿಸಿ, ಅಥವಾ ಬರೆಯಿರಿ."],
  "home.issue.audio": ["Sahay's voice did not play.", "सहाय की आवाज़ नहीं चली।", "ಸಹಾಯ್ ಧ್ವನಿ ಕೇಳಿಸಲಿಲ್ಲ."],
  "home.issue.token": ["This call may stop soon. Call again if it does.", "यह कॉल जल्द रुक सकती है। रुके तो फिर से जोड़ें।", "ಈ ಕರೆ ಬೇಗ ನಿಲ್ಲಬಹುದು. ನಿಂತರೆ ಮತ್ತೆ ಕರೆ ಮಾಡಿ."],
  "home.issue.agent": ["Sahay has not joined yet. Wait, or end and call again.", "सहाय अभी जुड़ी नहीं। रुकिए, या बंद करके फिर जोड़ें।", "ಸಹಾಯ್ ಇನ್ನೂ ಸೇರಿಲ್ಲ. ಕಾಯಿರಿ, ಅಥವಾ ಮುಗಿಸಿ ಮತ್ತೆ ಕರೆ ಮಾಡಿ."],
  "home.issue.message": ["A message did not reach Sahay. Say it again.", "एक संदेश सहाय तक नहीं पहुँचा। फिर से कहिए।", "ಒಂದು ಸಂದೇಶ ಸಹಾಯ್‌ಗೆ ತಲುಪಲಿಲ್ಲ. ಮತ್ತೆ ಹೇಳಿ."],
  "home.issue.other": ["Something went wrong on the call.", "कॉल में कुछ गड़बड़ हुई।", "ಕರೆಯಲ್ಲಿ ಏನೋ ತಪ್ಪಾಯಿತು."],

  // Needs you.
  "home.needs": ["Needs you", "आपकी हाँ चाहिए", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಬೇಕು"],
  "home.needsEmpty": ["Nothing needs you right now.", "अभी किसी काम में आपकी ज़रूरत नहीं।", "ಈಗ ಯಾವುದಕ್ಕೂ ನಿಮ್ಮ ಅಗತ್ಯವಿಲ್ಲ."],
  "home.needsAll": ["Show all ({n})", "सब देखें ({n})", "ಎಲ್ಲಾ ನೋಡಿ ({n})"],
  "home.showAll": ["Show all", "सब देखें", "ಎಲ್ಲಾ ನೋಡಿ"],
  "home.showLess": ["Show less", "कम दिखाएँ", "ಕಡಿಮೆ ತೋರಿಸಿ"],
  "home.check": ["Check", "देखें", "ನೋಡಿ"],
  "home.checkLong": ["Check: {line}", "देखें: {line}", "ನೋಡಿ: {line}"],

  // Today.
  "home.today": ["Today", "आज", "ಇಂದು"],
  "home.stat.orders": ["Orders", "ऑर्डर", "ಆರ್ಡರ್"],
  "home.stat.bills": ["Bills", "बिल", "ಬಿಲ್"],
  "home.stat.received": ["Money in", "आया पैसा", "ಬಂದ ಹಣ"],
  "home.stat.low": ["Low stock", "कम माल", "ಕಡಿಮೆ ಸ್ಟಾಕ್"],
  "home.statOpen": ["{word}: {value}. Open", "{word}: {value}। खोलें", "{word}: {value}. ತೆರೆಯಿರಿ"],
  "home.statsFail": ["Some of today's numbers did not load.", "आज के कुछ आँकड़े नहीं आए।", "ಇಂದಿನ ಕೆಲವು ಅಂಕಿಗಳು ಬರಲಿಲ್ಲ."],

  // Conversation.
  "home.convo": ["Conversation", "बातचीत", "ಸಂಭಾಷಣೆ"],
  "home.earlier": ["Earlier ({n})", "पहले की बातें ({n})", "ಹಿಂದಿನ ಮಾತು ({n})"],
  "home.earlierHide": ["Hide earlier", "पहले की बातें छिपाएँ", "ಹಿಂದಿನ ಮಾತು ಮುಚ್ಚಿ"],
  "home.you": ["You", "आप", "ನೀವು"],
  "home.sahay": ["Sahay", "सहाय", "ಸಹಾಯ್"],
  "home.typed": ["typed", "लिखा हुआ", "ಬರೆದದ್ದು"],
  "home.hearing": ["hearing", "सुन रही है", "ಕೇಳುತ್ತಿದೆ"],
  "home.cut": ["cut short", "बीच में रुका", "ಮಧ್ಯದಲ್ಲಿ ನಿಂತಿತು"],

  // Typing.
  "home.composer": ["Message to Sahay", "सहाय को संदेश", "ಸಹಾಯ್‌ಗೆ ಸಂದೇಶ"],
  "home.send": ["Send", "भेजें", "ಕಳುಹಿಸಿ"],
  "home.sending": ["Sending", "भेज रहे हैं", "ಕಳುಹಿಸುತ್ತಿದೆ"],
  "home.sendFail": ["Not sent. Tap Send again.", "नहीं गया। फिर से भेजें दबाइए।", "ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಕಳುಹಿಸಿ ಒತ್ತಿ."],
  "home.micStaysOn": ["Your mic stays on, so you can still say yes.", "माइक चालू रहता है, आप हाँ बोल सकते हैं।", "ಮೈಕ್ ಆನ್ ಇರುತ್ತದೆ, ನೀವು ಹೌದು ಎನ್ನಬಹುದು."],
  "home.typedStarts": ["Sending starts a typed chat. The mic stays off.", "भेजते ही लिखकर बात शुरू होगी। माइक बंद रहेगा।", "ಕಳುಹಿಸಿದರೆ ಬರೆದು ಮಾತು ಶುರು. ಮೈಕ್ ಆಫ್ ಇರುತ್ತದೆ."],
  "home.typedYes": ["A typed yes does not count. Tap Check and press Yes.", "लिखी हुई हाँ नहीं गिनी जाती। देखें दबाकर हाँ दबाइए।", "ಬರೆದ ಹೌದು ಎಣಿಕೆಯಾಗುವುದಿಲ್ಲ. ನೋಡಿ ಒತ್ತಿ, ಹೌದು ಒತ್ತಿ."],
});
