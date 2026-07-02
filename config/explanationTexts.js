/**
 * Explanation metinleri (Türkçe) — panel için tek doğruluk kaynağı.
 *
 * Key formatı consultantCatalog.js EXPLANATIONS_BY_JOB ile birebir aynıdır
 * (ör: "explanation_family_assistant_3"). Metinler Flutter l10n (app_tr.arb)
 * ile senkron tutulmalıdır; panelde rehber açıklama şablonu seçilirken gösterilir.
 */

'use strict';

const EXPLANATION_TEXTS = Object.freeze({
  // family_assistant
  explanation_family_assistant_1:
    'Derin köklü aile çatışmalarını çözme ve gerilmiş ilişkileri yeniden kurma konusunda uzmanlaşmış özel bir aile rehberi. Boşanma gibi zorlu geçiş süreçlerinde ailelere yol gösterirken, davranışsal değişiklikler yaşayan çocuklara rehberlik eder.',
  explanation_family_assistant_2:
    'En önemli bağları güçlendirmeye odaklanan sıcak ve empatik bir aile rehberi. Çocukların duygusal ve davranışsal gelişimini desteklerken, zor dönemlerin ardından ailelerin iyileşmesine yardımcı olur.',
  explanation_family_assistant_3:
    'Anne-baba ile çocuklar arasındaki güveni yeniden inşa etmek ve gergin ilişkileri onarmak konusunda derin deneyime sahip empatik bir aile rehberi.',
  explanation_family_assistant_4:
    'Sağlıklı sınırlar belirlemenize, iletişimi iyileştirmenize ve huzurlu bir ev ortamı yaratmanıza yardımcı olan çözüm odaklı bir aile rehberi.',
  explanation_family_assistant_5:
    'Boşanma, ayrılık veya büyük yaşam geçişleri yaşayan ailelere şefkat ve netlikle eşlik eden bilge ve sabırlı bir rehber.',
  explanation_family_assistant_6:
    'Çocukları davranışsal zorluklarda destekleyen ve ebeveynlere kanıta dayalı, pratik stratejiler kazandıran şefkatli bir rehber.',
  explanation_family_assistant_7:
    'Eve kalıcı uyum getirmek için duygusal, iletişimsel ve yapısal yaklaşımları birleştiren bütüncül bir aile rehberi.',
  explanation_family_assistant_8:
    'Geçmiş yaraları iyileştirmek ve daha güçlü, daha dayanıklı bağlar kurmak için ailelere yol gösteren ılık ve güçlendirici bir rehber.',
  explanation_family_assistant_9:
    'Günlük ebeveynlik çözümleri, çatışma yönetimi ve tutarlı rutinler oluşturma konusunda pragmatik bir aile rehberi.',
  explanation_family_assistant_10:
    'Denge ve bağlılık arayan üvey aileler, üvey ebeveynler ve farklı hane yapıları için şefkatli bir rehber.',
  explanation_family_assistant_11:
    'Aile bireylerinin duygusal güvenliğini koruyarak yas, kayıp ve büyük değişimleri işlemelerine yardımcı olan nazik ve becerikli bir rehber.',
  explanation_family_assistant_12:
    'Kuşaklar boyu derin bağlı, duygusal olarak sağlıklı aileler yetiştirmeye odaklanan uzun vadeli bir rehber.',

  // thought_and_habit_guide
  explanation_thought_and_habit_guide_1:
    'Düşünce yapınızı ve günlük alışkanlıklarınızı dönüştürmeye odaklanan bir rehber. Sınırlayıcı düşünce kalıplarını kırmanıza, güçlendirici rutinler oluşturmanıza ve kanıta dayalı teknikler aracılığıyla kalıcı pozitif değişim yaratmanıza yardımcı olur.',
  explanation_thought_and_habit_guide_2:
    'Sınırlayıcı düşünce kalıplarını fark etmenize ve kanıta dayalı bilişsel tekniklerle yeniden şekillendirmenize yardımcı olan pratik bir rehber.',
  explanation_thought_and_habit_guide_3:
    'Alışkanlık oluşumunda uzmanlaşmış sabırlı bir mentor — küçük günlük rutinleri kalıcı değişime dönüştürmenize yardımcı olur.',
  explanation_thought_and_habit_guide_4:
    'Olumsuz iç sesi farkındalık temelli pratiklerle dengeli, yapıcı düşünmeye dönüştüren odaklanmış bir rehber.',
  explanation_thought_and_habit_guide_5:
    'Zihniyet değişimlerini eyleme dönüştüren alışkanlıklarla birleştirip ölçülebilir kişisel gelişim sağlayan motive edici bir rehber.',
  explanation_thought_and_habit_guide_6:
    'Davranışlarınızı yöneten temel inançları keşfetmenize ve onları niyetle yeniden yazmanıza yardımcı olan yansıtıcı bir rehber.',
  explanation_thought_and_habit_guide_7:
    "Aşırı düşünme döngülerini kırıp yerine sağlam, an'da kalma farkındalığını yerleştirmeye odaklı güçlendirici bir rehber.",
  explanation_thought_and_habit_guide_8:
    'Hayatınızı dönüştüren sabah rutinleri, derin çalışma alışkanlıkları ve dinlenme ritüelleri kurmanıza yardımcı olan yapılandırılmış bir koç.',
  explanation_thought_and_habit_guide_9:
    'Mükemmeliyetçiliği bırakmanıza ve performans yerine ilerlemeyi kucaklamanıza destek olan şefkatli bir rehber.',
  explanation_thought_and_habit_guide_10:
    'Zihinsel döngüleri çözüp ilerleyen, sürdürülebilir net yollar oluşturan çözüm odaklı bir rehber.',
  explanation_thought_and_habit_guide_11:
    'Günlük alışkanlıklarınızı en derin değerleriniz ve uzun vadeli vizyonunuzla hizalamak için bilge bir mentor.',
  explanation_thought_and_habit_guide_12:
    'Düşünce ve alışkanlık çalışmasıyla daha sakin, daha net, daha niyetli bir iç dünya inşa etmenize yardımcı olan sağlam bir rehber.',

  // adult
  explanation_adult_1:
    'Anlamlı bir değişim arayan yetişkinler için sonuç odaklı bir rehber. Pratik, hedefe yönelik stratejiler aracılığıyla stres yönetimi, yaşam dengesi ve kariyer rehberliğine odaklanır.',
  explanation_adult_2:
    'Özgüven oluşturmaktan ve stresi yönetmekten kariyer yönü ve günlük motivasyon bulmaya kadar, yetişkinleri tam potansiyellerine ulaşmaları için güçlendiren bütünsel bir gelişim rehberi.',
  explanation_adult_3:
    'Kariyer geçişleri ve yaşam dengesi zorlukları yaşayan yetişkinler için pratik, sonuç odaklı bir rehber.',
  explanation_adult_4:
    'Yetişkinlerin günlük yaşamlarında amaç, motivasyon ve netliği yeniden keşfetmelerine yardımcı olan güçlendirici bir rehber.',
  explanation_adult_5:
    'Daha derin öz anlayış, duygusal düzenleme ve anlamlı kişisel gelişim arayan yetişkinler için bilge bir mentor.',
  explanation_adult_6:
    'Yüksek baskılı kariyerler, karar yorgunluğu ve tükenmişlik iyileşmesinde yetişkinleri destekleyen odaklanmış bir rehber.',
  explanation_adult_7:
    'Stresi yönetmek, öz güven inşa etmek ve niyetli yaşamak isteyen yetişkinler için sağlam temelli bir rehber.',
  explanation_adult_8:
    'Yetişkin refahı için zihinsel, duygusal ve pratik stratejileri birleştiren bütüncül bir rehber.',
  explanation_adult_9:
    'Orta yaş soruları, kimlik değişimleri ya da yeni başlangıçlar yaşayan yetişkinler için şefkatli bir rehber.',
  explanation_adult_10:
    'Hesap verebilirlik ve yapılandırılmış ilerleme ile yetişkinlerin niyetlerini eyleme dönüştürmelerine yardımcı olan becerikli bir motivator.',
  explanation_adult_11:
    'İş-yaşam dengesi, sağlıklı sınırlar ve otantik ilişkiler arayan yetişkinler için yansıtıcı bir rehber.',
  explanation_adult_12:
    'Yetişkinlere kariyer, ilişkiler ve kişisel evrim sürecinde destek olan uzun vadeli bir gelişim ortağı.',

  // child
  explanation_child_1:
    'Çocukların en biçimlendirici yılları için şefkatli bir rehber. Çocukların duygusal farkındalık geliştirmelerine, sosyal beceriler inşa etmelerine, okula uyum sağlamalarına, korkularını yenmelerine ve odaklanmalarını geliştirmelerine yardımcı olur.',
  explanation_child_2:
    'Çocukların duygularını ifade etmeyi, arkadaşlıklar kurmayı ve güvenle büyümeyi öğrendikleri güvenli bir ortam yaratarak gelişmelerine yardımcı olmaya adanmış ilgili ve sabırlı bir rehber.',
  explanation_child_3:
    'Çocukların duygularını yaşa uygun hikayeler ve egzersizlerle tanımlayıp adlandırmasına yardımcı olan oyuncu ve nazik bir rehber.',
  explanation_child_4:
    'Çekingen veya kaygılı çocukların kendilerini ifade etmesine ve sosyal güven inşa etmesine destek olan sabırlı bir rehber.',
  explanation_child_5:
    'Yaratıcı oyunla çocukların duygularını işlemesine ve korkularıyla güvenle yüzleşmesine yardımcı olan yaratıcı bir rehber.',
  explanation_child_6:
    'Okula, yeni ortamlara veya aile değişimlerine uyum sağlayan çocuklar için şefkatli bir rehber.',
  explanation_child_7:
    'Pozitif pekiştirme ile çocukların odak, öz kontrol ve davranışsal farkındalığını geliştiren cesaretlendirici bir rehber.',
  explanation_child_8:
    'Çocukların sağlıklı arkadaşlıklar kurmasına ve sosyal zorluklarla başa çıkmasına yardımcı olan sıcak ve neşeli bir rehber.',
  explanation_child_9:
    'Davranış zorlukları, duyusal ihtiyaçlar veya dikkat sorunları yaşayan çocuklar için becerikli bir rehber.',
  explanation_child_10:
    'Korkular, kabuslar veya kaygı yaşayan çocuklar için güven veren bir rehber — kendilerini güvende ve anlaşılmış hissetmelerine yardımcı olur.',
  explanation_child_11:
    'Çocukların büyük duyguları ve zor durumları nazikçe işlemesine yardımcı olan yaratıcı hikaye anlatıcı bir rehber.',
  explanation_child_12:
    'Çocukların duygusal, sosyal ve bilişsel gelişimini bütüncül olarak destekleyen uzun vadeli gelişim rehberi.',

  // teenage
  explanation_teenage_1:
    'Ergenliği derinden anlayan bir rehber. Gençlerin öz saygılarını güçlendirmelerine, öfkelerini kontrol etmelerine, geleceklerini planlamalarına ve ebeveynleriyle açık bir iletişim kurmalarına yardımcı olur.',
  explanation_teenage_2:
    'Çalkantılı gençlik yıllarında empatik bir rehber. Gençlerin psikolojik dayanıklılık geliştirmelerini, öfkelerini yapıcı bir şekilde yönetmelerini ve sağlıklı ebeveyn-genç ilişkileri sürdürmelerini sağlar.',
  explanation_teenage_3:
    'Gençlerin dilinden konuşan tanıdık bir rehber — kimlik keşfini ve gerçek özgüven inşasını destekler.',
  explanation_teenage_4:
    'Akran baskısı, sosyal dramalar veya kimlik soruları yaşayan gençler için yargılamayan bir rehber.',
  explanation_teenage_5:
    'Tükenmişliğe düşmeden okul, sosyal yaşam ve öz bakımı dengelemeye yardımcı olan akademik-yaşam odaklı bir rehber.',
  explanation_teenage_6:
    'Sosyal medya ve ekranlarla sağlıklı sınırlar kurmak isteyen gençler için dijital iyi oluş duyarlı bir rehber.',
  explanation_teenage_7:
    'Öfke, hayal kırıklığı ve büyük duyguları yapıcı şekilde yönetmeyi öğrenen gençler için güçlendirici bir rehber.',
  explanation_teenage_8:
    'Geleceği — üniversite, kariyer, ara yıl — merak ve netlikle planlamasına yardımcı olan pratik bir rehber.',
  explanation_teenage_9:
    'Anne-baba ile genç arasındaki iletişimi iyileştirip evdeki güveni yeniden inşa etmeye yardımcı olan sabırlı bir arabulucu.',
  explanation_teenage_10:
    'Beden imajı, öz saygı veya kimlik mücadelesi yaşayan gençleri destekleyen güven inşa edici bir rehber.',
  explanation_teenage_11:
    'Yalnızlık, kaygı veya anlaşılmama hisleri yaşayan gençler için şefkatli bir rehber.',
  explanation_teenage_12:
    'Uzun vadeli duygusal sağlık, dayanıklılık ve otantik kendini ifadeye odaklı bütüncül bir genç rehberi.',

  // personal
  explanation_personal_1:
    'Duygusal iyi oluşa odaklanan derinden şefkatli bir rehber. Aşırı düşünmekten kurtulmanız için farkındalık, duygusal iyileşme ve kendini keşfetme konularında size rehberlik eder.',
  explanation_personal_2:
    'Kendinizle yeniden bağlantı kurmanıza yardımcı olan destekleyici bir kişisel rehber. Gerçek iç huzuruna ulaşmak için anksiyete yönetimi, farkındalık ve uyku düzeni konularında uzmanlaşmıştır.',
  explanation_personal_3:
    'Günlük tutma, farkındalık ve iç çalışma yoluyla daha derin öz anlayış arayanlar için yansıtıcı bir rehber.',
  explanation_personal_4:
    'Kaygıdan, sağlam ve kanıta dayalı tekniklerle çıkmanıza yardımcı olan sakinleştirici bir rehber.',
  explanation_personal_5:
    'Yas, kayıp veya büyük yaşam geçişleri yaşayanlar için şefkatli bir yol arkadaşı.',
  explanation_personal_6:
    "Günlük iç huzur için nefes, meditasyon ve an'da kalma pratikleri öğreten farkındalık temelli bir rehber.",
  explanation_personal_7:
    'Dinlendirici geceler ve enerjik günler inşa etmenize yardımcı olan uyku ve toparlanma odaklı bir rehber.',
  explanation_personal_8:
    'Aşırı düşünme döngüsünde kalanlar için zihinsel netlik ve hafiflik bulmaya yardımcı olan düşünceli bir rehber.',
  explanation_personal_9:
    'Anlam, değer ve yön bulmak için öz keşif yolculuğunuza eşlik eden meraklı bir rehber.',
  explanation_personal_10:
    'Duygusal yaralar taşıyanlar için şefkatle işleyip serbest bırakmaya yardımcı olan iyileşme odaklı bir rehber.',
  explanation_personal_11:
    'Yalnız veya kopuk hisseden kişiler için varlık, perspektif ve sıcak destek sunan nazik bir rehber.',
  explanation_personal_12:
    'Sürekli duygusal gelişim, iyileşme ve öz ustalık için uzun vadeli iç-yaşam rehberi.',

  // exam_anxiety
  explanation_exam_anxiety_1:
    'Sınav stresini özgüvenli bir performansa dönüştüren odaklı bir rehber. Öğrencileri zaman yönetimi, gevşeme yöntemleri ve özgüven geliştirme stratejileri ile donatır.',
  explanation_exam_anxiety_2:
    'Öğrencilerin sınav kaygısını aşmalarına ve kanıtlanmış teknikler ile yapılandırılmış sınav hazırlığı aracılığıyla daha akıllıca çalışmalarına yardımcı olmaya adanmış uzman bir akademik rehber.',
  explanation_exam_anxiety_3:
    'Sınav paniğini odaklı, kendine güvenli performansa dönüştürmeye yardımcı olan sakinleştirici bir rehber.',
  explanation_exam_anxiety_4:
    'Verimli teknikler, hafıza araçları ve aktif geri çağırma stratejileri öğreten ders çalışma uzmanı.',
  explanation_exam_anxiety_5:
    'Öğrencilere çalışma programı planlayıp ona bağlı kalmayı öğreten pratik bir zaman yönetimi koçu.',
  explanation_exam_anxiety_6:
    'Performans kaygısını azaltmak için nefes, topraklanma ve görselleştirme öğreten baskı azaltıcı bir rehber.',
  explanation_exam_anxiety_7:
    'Konsantrasyon, dikkat dağılması veya erteleme ile mücadele eden öğrenciler için odak inşa edici bir rehber.',
  explanation_exam_anxiety_8:
    'Akademik baskı altında sakin kalmak için sürdürülebilir stratejiler öğreten gevşeme odaklı bir rehber.',
  explanation_exam_anxiety_9:
    'Öğrencileri kanıtlanmış hazırlık çerçeveleriyle adım adım hazırlığa yönlendiren yapılandırılmış bir sınav koçu.',
  explanation_exam_anxiety_10:
    'Öğrencilerin yeteneklerine inanıp hazırlıklarına güvenmelerine yardımcı olan güven inşa edici bir rehber.',
  explanation_exam_anxiety_11:
    'Üniversite girişi gibi yüksek riskli sınavlar öncesi öz şüpheyle savaşan öğrenciler için cesaretlendirici bir rehber.',
  explanation_exam_anxiety_12:
    'Tek bir sınav değil, yıllarca okul zorlukları için dayanıklılık inşa eden uzun vadeli akademik refah rehberi.',

  // emotional_balance
  explanation_emotional_balance_1:
    'Duygularınızı tanımanıza ve şefkatle işlemenize yardımcı olan sıcak ve sezgisel bir rehber. Duygusal dayanıklılık, iç huzur ve kendinizle ile başkalarıyla özgün bağlantı kurmanızı destekler.',
  explanation_emotional_balance_2:
    'Duyguları tanıyıp adlandırma ve pratik farkındalık araçlarıyla düzenleme öğreten sakinleştirici bir rehber.',
  explanation_emotional_balance_3:
    'Bunalmış hissedenler için iç dengeyi ve netliği yeniden kazanmaya yardımcı olan sağlam bir rehber.',
  explanation_emotional_balance_4:
    'Duygusal iniş çıkışlarda sabır ve kanıtlanmış tekniklerle size eşlik eden bilge bir rehber.',
  explanation_emotional_balance_5:
    'Her şeyi derinden hissedenler için duyarlılığı güce dönüştüren şefkatli bir rehber.',
  explanation_emotional_balance_6:
    'Günlük farkındalık pratikleriyle duygusal dayanıklılık inşa etmeye odaklı farkındalık temelli bir rehber.',
  explanation_emotional_balance_7:
    'Söylenmeyen duyguları işlemenize ve otantik benliğinizle yeniden bağlanmanıza yardımcı olan yansıtıcı bir rehber.',
  explanation_emotional_balance_8:
    'Öfke, üzüntü, korku ve sevinci bastırmadan sağlıklı yollarla ifade etmeyi öğreten dengeli bir rehber.',
  explanation_emotional_balance_9:
    'Duygusal tepkilerinizin altındaki kalıpları anlamanıza destek olan öz keşif rehberi.',
  explanation_emotional_balance_10:
    'Duygusal kaostan merkezli dinginliğe geçmenize tek bir pratikle yardımcı olan huzurlu bir rehber.',
  explanation_emotional_balance_11:
    'Duygusal düzenlemeyi günlük zorluklar için pratik araçlarla birleştiren kaygı duyarlı bir rehber.',
  explanation_emotional_balance_12:
    'Hayatın mevsimleri boyunca duygusal iyi oluşunuza destek olan uzun vadeli iç denge rehberi.',

  // difficult_experiences
  explanation_difficult_experiences_1:
    'Hayatın en zorlu anlarında —kayıp, travma, yas ve belirsizlik— yanınızda yürüyen şefkatli ve deneyimli bir rehber. Zor duyguları işlemenize, zorluklarda anlam bulmanıza ve yenilenen güçle yeniden inşa etmenize yardımcı olur.',
  explanation_difficult_experiences_2:
    'Yas, travma ve hayatın en zor bölümlerinde sabır ve özenle yanınızda yürüyen şefkatli bir rehber.',
  explanation_difficult_experiences_3:
    'Acı verici deneyimleri kendi tempokuzda güvenle işlemenize yardımcı olan travma bilgili bir rehber.',
  explanation_difficult_experiences_4:
    'Kayıp yaşayanlar için varlık, perspektif ve iyileşme araçları sunan nazik bir rehber.',
  explanation_difficult_experiences_5:
    'Hayat belirsiz ya da bunaltıcı geldiğinde topraklanmanıza yardımcı olan kaygı bilinçli bir rehber.',
  explanation_difficult_experiences_6:
    'Acısında yalnız hissedenler için sıcak bir rehber — iyileşmenin bağlantı içinde olduğunu hatırlatır.',
  explanation_difficult_experiences_7:
    'Zorluklarla öz değeri sarsılanlar için yeniden inşa edici bir rehber.',
  explanation_difficult_experiences_8:
    'Zor deneyimler sırasında ve sonrasında ortaya çıkan yoğun duyguları düzenlemeye yardımcı olan becerikli bir rehber.',
  explanation_difficult_experiences_9:
    "Geçmişe dair sarmal düşüncelere panzehir olarak an'da kalmayı öğreten farkındalık temelli bir rehber.",
  explanation_difficult_experiences_10:
    'Büyük yaşam altüst oluşları sonrası kimlik ve anlamı yeniden inşa edenler için öz keşif rehberi.',
  explanation_difficult_experiences_11:
    'Süreci hızlandırmadan veya kısa kesmeden uzun vadeli duygusal iyileşmeyi destekleyen sabırlı bir rehber.',
  explanation_difficult_experiences_12:
    'Zorluklar yoluyla güç, anlam ve yenilenmiş umut bulmanıza yardımcı olan dayanıklılık inşa edici rehber.',

  // resilience_empowerment
  explanation_resilience_empowerment_1:
    'İç gücünüzü keşfetmenize yardımcı olmaya adanmış, motive edici ve güç odaklı bir rehber. Zorluklar, geri adımlar ve geçiş süreçlerinde size rehberlik eder — hayatın getirdiklerine karşı durmak için dayanıklılık ve özgüven inşa eder.',
  explanation_resilience_empowerment_2:
    'Sarsılmaz öz güven ve yeteneklerinize duyduğunuz inancı inşa etmenize yardımcı olan motive edici bir rehber.',
  explanation_resilience_empowerment_3:
    'Geri adımları basamağa, engelleri fırsata dönüştüren büyüme odaklı bir rehber.',
  explanation_resilience_empowerment_4:
    'Gizli güçlerinizi keşfetmenize ve otantik gücünüzle hizalanmanıza yardımcı olan öz keşif rehberi.',
  explanation_resilience_empowerment_5:
    'Büyük kararlarla yüzleşenler için kendinize güvenip cesurca hareket etmenizi sağlayan netlik rehberi.',
  explanation_resilience_empowerment_6:
    'Hayatın zorluklarına tepki vermek yerine yanıt vermenizi sağlayan, farkındalığı güçlendirmeyle eşleştiren bir rehber.',
  explanation_resilience_empowerment_7:
    'Sert öz eleştiriyi gerçek öz saygıyla değiştirmenize yardımcı olan öz saygı odaklı bir rehber.',
  explanation_resilience_empowerment_8:
    'Yeni rollere, kariyerlere veya yaşam bölümlerine adım atanlar için güven inşa edici bir rehber.',
  explanation_resilience_empowerment_9:
    'Hayal kırıklığı, reddedilme veya başarısızlıktan daha güçlü çıkmanıza yardımcı olan pratik bir rehber.',
  explanation_resilience_empowerment_10:
    'Kalıcı güç, cesaret ve öz güven inşa etmenize adanmış güçlendirici uzun vadeli bir rehber.',
  explanation_resilience_empowerment_11:
    'Kendi gerçeğinizde dik durmanıza, sağlam sınırlar koymanıza ve enerjinizi korumanıza yardımcı olan bilge bir mentor.',
  explanation_resilience_empowerment_12:
    'Sürekli büyüme, cesaret ve öz güçlenme yolculuğunuza destek olan bütüncül bir dayanıklılık rehberi.',
});

module.exports = { EXPLANATION_TEXTS };
