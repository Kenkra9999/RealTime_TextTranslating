/**
 * LinguaContext Pro - Offline Dictionary & IPA Database
 * Provides offline IPA transcriptions, POS tagging, and Vietnamese meanings.
 * Comprehensive dictionary covering academic, IELTS, TOEFL, nature, biology vocabulary.
 */
class DictionaryDB {
    constructor() {
        this.cache = new Map();
        this.dict = {
            // === ACADEMIC & GENERAL VOCABULARY ===
            "resilient": { ipa: "/rɪˈzɪl.jənt/", pos: "adj.", meaning: "kiên cường, có khả năng phục hồi nhanh" },
            "resilience": { ipa: "/rɪˈzɪl.jəns/", pos: "n.", meaning: "sự kiên cường, khả năng phục hồi" },
            "profound": { ipa: "/prəˈfaʊnd/", pos: "adj.", meaning: "sâu sắc, uyên thâm" },
            "ubiquitous": { ipa: "/juːˈbɪk.wɪ.təs/", pos: "adj.", meaning: "phổ biến ở khắp mọi nơi" },
            "meticulous": { ipa: "/məˈtɪk.jə.ləs/", pos: "adj.", meaning: "tỉ mỉ, cẩn thận từng chi tiết" },
            "scrutinize": { ipa: "/ˈskruː.tɪ.naɪz/", pos: "v.", meaning: "xem xét tỉ mỉ, nghiên cứu kỹ lưỡng" },
            "scrutiny": { ipa: "/ˈskruː.tɪ.ni/", pos: "n.", meaning: "sự xem xét kỹ lưỡng" },
            "paradigm": { ipa: "/ˈpær.ə.daɪm/", pos: "n.", meaning: "mô hình, kiểu mẫu" },
            "paradigm shift": { ipa: "/ˈpær.ə.daɪm ʃɪft/", pos: "n. phr.", meaning: "sự thay đổi tư duy/mô hình căn bản" },
            "pivotal": { ipa: "/ˈpɪv.ə.təl/", pos: "adj.", meaning: "nòng cốt, quan trọng mang tính quyết định" },
            "synergy": { ipa: "/ˈsɪn.ə.dʒi/", pos: "n.", meaning: "sự hiệp lực, hỗ trợ lẫn nhau" },
            "catalyst": { ipa: "/ˈkæt.əl.ɪst/", pos: "n.", meaning: "chất xúc tác, nhân tố thúc đẩy" },
            "eloquent": { ipa: "/ˈel.ə.kwənt/", pos: "adj.", meaning: "hùng hồn, có sức thuyết phục" },
            "pragmatic": { ipa: "/præɡˈmæt.ɪk/", pos: "adj.", meaning: "thực tế, thực dụng" },
            "diligence": { ipa: "/ˈdɪl.ɪ.dʒəns/", pos: "n.", meaning: "sự siêng năng, cần cù" },
            "diligent": { ipa: "/ˈdɪl.ɪ.dʒənt/", pos: "adj.", meaning: "siêng năng, cần cù" },
            "ephemeral": { ipa: "/ɪˈfem.ər.əl/", pos: "adj.", meaning: "phù du, chóng tàn, ngắn ngủi" },
            "unprecedented": { ipa: "/ʌnˈpres.ɪ.den.tɪd/", pos: "adj.", meaning: "chưa từng có tiền lệ" },
            "exponential": { ipa: "/ˌek.spəˈnen.ʃəl/", pos: "adj.", meaning: "theo cấp số nhân, tăng cực nhanh" },
            "comprehensive": { ipa: "/ˌkɒm.prɪˈhen.sɪv/", pos: "adj.", meaning: "toàn diện, bao quát" },
            "sustainable": { ipa: "/səˈsteɪ.nə.bəl/", pos: "adj.", meaning: "bền vững" },
            "sustainability": { ipa: "/səˌsteɪ.nəˈbɪl.ə.ti/", pos: "n.", meaning: "sự bền vững" },
            "implement": { ipa: "/ˈɪm.plɪ.ment/", pos: "v.", meaning: "thi hành, thực hiện, triển khai" },
            "implementation": { ipa: "/ˌɪm.plɪ.menˈteɪ.ʃən/", pos: "n.", meaning: "sự thi hành, triển khai" },
            "foster": { ipa: "/ˈfɒs.tər/", pos: "v.", meaning: "thúc đẩy, nuôi dưỡng, khuyến khích" },
            "empirical": { ipa: "/ɪmˈpɪr.ɪ.kəl/", pos: "adj.", meaning: "thực nghiệm, dựa trên quan sát" },
            "ambiguity": { ipa: "/ˌæm.bɪˈɡjuː.ə.ti/", pos: "n.", meaning: "sự mơ hồ, không rõ ràng" },
            "ambiguous": { ipa: "/æmˈbɪɡ.ju.əs/", pos: "adj.", meaning: "mơ hồ, nhập nhằng" },
            "innovative": { ipa: "/ˈɪn.ə.və.tɪv/", pos: "adj.", meaning: "đổi mới, sáng tạo" },
            "innovation": { ipa: "/ˌɪn.əˈveɪ.ʃən/", pos: "n.", meaning: "sự đổi mới, sáng tạo" },
            "breakthrough": { ipa: "/ˈbreɪk.θruː/", pos: "n.", meaning: "bước đột phá" },
            "perspective": { ipa: "/pəˈspek.tɪv/", pos: "n.", meaning: "góc nhìn, quan điểm" },
            "collaborate": { ipa: "/kəˈlæb.ə.reɪt/", pos: "v.", meaning: "hợp tác, cộng tác" },
            "collaboration": { ipa: "/kəˌlæb.əˈreɪ.ʃən/", pos: "n.", meaning: "sự hợp tác" },
            "cutting-edge": { ipa: "/ˌkʌt.ɪŋˈedʒ/", pos: "adj.", meaning: "tiên tiến nhất, hiện đại nhất" },
            "state-of-the-art": { ipa: "/ˌsteɪt.əv.ðiːˈɑːt/", pos: "adj.", meaning: "hiện đại nhất, trình độ cao nhất" },
            "leverage": { ipa: "/ˈliː.vər.ɪdʒ/", pos: "v., n.", meaning: "tận dụng, đòn bẩy" },
            "optimize": { ipa: "/ˈɒp.tɪ.maɪz/", pos: "v.", meaning: "tối ưu hóa" },
            "benchmark": { ipa: "/ˈbentʃ.mɑːk/", pos: "n.", meaning: "tiêu chuẩn so sánh, mốc chuẩn" },
            "game-changer": { ipa: "/ˈɡeɪmˌtʃeɪn.dʒər/", pos: "n.", meaning: "yếu tố thay đổi cuộc chơi" },
            "paradox": { ipa: "/ˈpær.ə.dɒks/", pos: "n.", meaning: "sự nghịch lý" },
            "crucial": { ipa: "/ˈkruː.ʃəl/", pos: "adj.", meaning: "cực kỳ quan trọng, sống còn" },
            "fundamental": { ipa: "/ˌfʌn.dəˈmen.təl/", pos: "adj.", meaning: "cơ bản, nền tảng" },
            "indispensable": { ipa: "/ˌɪn.dɪˈspen.sə.bəl/", pos: "adj.", meaning: "không thể thiếu" },
            "versatile": { ipa: "/ˈvɜː.sə.taɪl/", pos: "adj.", meaning: "đa năng, linh hoạt" },
            "aesthetic": { ipa: "/esˈθet.ɪk/", pos: "adj.", meaning: "thẩm mỹ, có tính nghệ thuật" },

            // === NATURE, BIOLOGY, ZOOLOGY ===
            "mammal": { ipa: "/ˈmæm.əl/", pos: "n.", meaning: "động vật có vú" },
            "mammals": { ipa: "/ˈmæm.əlz/", pos: "n.", meaning: "các loài động vật có vú" },
            "bovid": { ipa: "/ˈboʊ.vɪd/", pos: "n.", meaning: "động vật thuộc họ Trâu Bò (Bovidae)" },
            "bovids": { ipa: "/ˈboʊ.vɪdz/", pos: "n.", meaning: "các loài thuộc họ Trâu Bò" },
            "species": { ipa: "/ˈspiː.ʃiːz/", pos: "n.", meaning: "loài, chủng loại" },
            "habitat": { ipa: "/ˈhæb.ɪ.tæt/", pos: "n.", meaning: "môi trường sống, sinh cảnh" },
            "habitats": { ipa: "/ˈhæb.ɪ.tæts/", pos: "n.", meaning: "các môi trường sống" },
            "predator": { ipa: "/ˈpred.ə.tər/", pos: "n.", meaning: "động vật ăn thịt, thú săn mồi" },
            "predators": { ipa: "/ˈpred.ə.tərz/", pos: "n.", meaning: "các loài thú săn mồi" },
            "prey": { ipa: "/preɪ/", pos: "n., v.", meaning: "con mồi, săn mồi" },
            "adaptation": { ipa: "/ˌæd.æpˈteɪ.ʃən/", pos: "n.", meaning: "sự thích nghi" },
            "adapted": { ipa: "/əˈdæp.tɪd/", pos: "v.", meaning: "đã thích nghi" },
            "ecosystem": { ipa: "/ˈiː.koʊˌsɪs.təm/", pos: "n.", meaning: "hệ sinh thái" },
            "conservation": { ipa: "/ˌkɒn.sɜːˈveɪ.ʃən/", pos: "n.", meaning: "sự bảo tồn" },
            "extinct": { ipa: "/ɪkˈstɪŋkt/", pos: "adj.", meaning: "tuyệt chủng" },
            "herbivorous": { ipa: "/hɜːˈbɪv.ər.əs/", pos: "adj.", meaning: "ăn cỏ, ăn thực vật" },
            "ruminant": { ipa: "/ˈruː.mɪ.nənt/", pos: "n.", meaning: "động vật nhai lại" },
            "ruminants": { ipa: "/ˈruː.mɪ.nənts/", pos: "n.", meaning: "các loài động vật nhai lại" },
            "regurgitate": { ipa: "/rɪˈɡɜː.dʒɪ.teɪt/", pos: "v.", meaning: "ợ lên, nhai lại thức ăn" },
            "offspring": { ipa: "/ˈɒf.sprɪŋ/", pos: "n.", meaning: "con cái, thế hệ sau" },
            "territory": { ipa: "/ˈter.ɪ.tɔː.ri/", pos: "n.", meaning: "lãnh thổ, vùng đất" },
            "population": { ipa: "/ˌpɒp.jʊˈleɪ.ʃən/", pos: "n.", meaning: "quần thể, dân số" },
            "diverse": { ipa: "/daɪˈvɜːs/", pos: "adj.", meaning: "đa dạng, phong phú" },
            "diversity": { ipa: "/daɪˈvɜː.sɪ.ti/", pos: "n.", meaning: "sự đa dạng" },
            "ancestor": { ipa: "/ˈæn.ses.tər/", pos: "n.", meaning: "tổ tiên, thủy tổ" },
            "ancestors": { ipa: "/ˈæn.ses.tərz/", pos: "n.", meaning: "các tổ tiên" },
            "evolution": { ipa: "/ˌiː.vəˈluː.ʃən/", pos: "n.", meaning: "sự tiến hóa" },
            "survival": { ipa: "/sərˈvaɪ.vəl/", pos: "n.", meaning: "sự sống sót, tồn tại" },
            "survive": { ipa: "/sərˈvaɪv/", pos: "v.", meaning: "sống sót, tồn tại" },
            "solitary": { ipa: "/ˈsɒl.ɪ.tər.i/", pos: "adj.", meaning: "sống đơn độc, cô lập" },
            "domestic": { ipa: "/dəˈmes.tɪk/", pos: "adj.", meaning: "nhà, thuần hóa, trong nước" },
            "grassland": { ipa: "/ˈɡrɑːs.lænd/", pos: "n.", meaning: "đồng cỏ, thảo nguyên" },
            "tundra": { ipa: "/ˈtʌn.drə/", pos: "n.", meaning: "lãnh nguyên, đài nguyên" },
            "tropical": { ipa: "/ˈtrɒp.ɪ.kəl/", pos: "adj.", meaning: "nhiệt đới" },
            "arid": { ipa: "/ˈær.ɪd/", pos: "adj.", meaning: "khô cằn" },
            "grazing": { ipa: "/ˈɡreɪ.zɪŋ/", pos: "n.", meaning: "sự gặm cỏ, chăn thả" },
            "browsing": { ipa: "/ˈbraʊ.zɪŋ/", pos: "n.", meaning: "sự ăn lá cây, gặm lá" },
            "antelope": { ipa: "/ˈæn.tɪ.loʊp/", pos: "n.", meaning: "linh dương" },
            "gazelle": { ipa: "/ɡəˈzel/", pos: "n.", meaning: "linh dương gazelle" },
            "springbok": { ipa: "/ˈsprɪŋ.bɒk/", pos: "n.", meaning: "linh dương springbok" },
            "buffalo": { ipa: "/ˈbʌf.ə.loʊ/", pos: "n.", meaning: "trâu" },
            "bison": { ipa: "/ˈbaɪ.sən/", pos: "n.", meaning: "bò rừng bison" },
            "cattle": { ipa: "/ˈkæt.əl/", pos: "n.", meaning: "gia súc, bò" },
            "sheep": { ipa: "/ʃiːp/", pos: "n.", meaning: "cừu" },
            "goat": { ipa: "/ɡoʊt/", pos: "n.", meaning: "dê" },
            "giraffe": { ipa: "/dʒɪˈrɑːf/", pos: "n.", meaning: "hươu cao cổ" },
            "giraffes": { ipa: "/dʒɪˈrɑːfs/", pos: "n.", meaning: "các con hươu cao cổ" },
            "ibex": { ipa: "/ˈaɪ.beks/", pos: "n.", meaning: "sơn dương" },
            "chamois": { ipa: "/ˈʃæm.wɑː/", pos: "n.", meaning: "sơn dương chamois" },
            "duiker": { ipa: "/ˈdaɪ.kər/", pos: "n.", meaning: "linh dương duiker" },
            "duikers": { ipa: "/ˈdaɪ.kərz/", pos: "n.", meaning: "các loài linh dương duiker" },
            "pronghorn": { ipa: "/ˈprɒŋ.hɔːn/", pos: "n.", meaning: "linh dương sừng nhánh" },
            "oryx": { ipa: "/ˈɔː.rɪks/", pos: "n.", meaning: "linh dương oryx" },
            "addax": { ipa: "/ˈæd.æks/", pos: "n.", meaning: "linh dương addax" },
            "waterbuck": { ipa: "/ˈwɔː.tə.bʌk/", pos: "n.", meaning: "linh dương nước" },
            "waterbucks": { ipa: "/ˈwɔː.tə.bʌks/", pos: "n.", meaning: "các con linh dương nước" },
            "lechwe": { ipa: "/ˈletʃ.weɪ/", pos: "n.", meaning: "linh dương lechwe" },
            "lechwes": { ipa: "/ˈletʃ.weɪz/", pos: "n.", meaning: "các con linh dương lechwe" },
            "puku": { ipa: "/ˈpuː.kuː/", pos: "n.", meaning: "linh dương puku" },
            "pukus": { ipa: "/ˈpuː.kuːz/", pos: "n.", meaning: "các con linh dương puku" },
            "sitatunga": { ipa: "/ˌsɪt.əˈtʌŋ.ɡə/", pos: "n.", meaning: "linh dương đầm lầy sitatunga" },
            "goral": { ipa: "/ˈɡɔː.rəl/", pos: "n.", meaning: "sơn dương goral" },
            "tahr": { ipa: "/tɑːr/", pos: "n.", meaning: "sơn dương tahr" },
            "auroch": { ipa: "/ˈɔː.rɒk/", pos: "n.", meaning: "bò rừng auroch (đã tuyệt chủng)" },
            "banteng": { ipa: "/ˈbæn.teŋ/", pos: "n.", meaning: "bò banteng" },
            "gaur": { ipa: "/ɡaʊr/", pos: "n.", meaning: "bò gaur, bò tót" },
            "yak": { ipa: "/jæk/", pos: "n.", meaning: "bò yak, bò Tây Tạng" },
            "musk": { ipa: "/mʌsk/", pos: "n.", meaning: "xạ hương" },
            "oxen": { ipa: "/ˈɒk.sən/", pos: "n.", meaning: "bò đực (số nhiều)" },
            "barbary": { ipa: "/ˈbɑː.bər.i/", pos: "adj.", meaning: "thuộc Barbary (Bắc Phi)" },
            "bighorn": { ipa: "/ˈbɪɡ.hɔːn/", pos: "n.", meaning: "cừu sừng lớn" },

            // === KEY VERBS, ADJECTIVES, ADVERBS ===
            "consist": { ipa: "/kənˈsɪst/", pos: "v.", meaning: "bao gồm, cấu thành" },
            "consisting": { ipa: "/kənˈsɪs.tɪŋ/", pos: "v.", meaning: "bao gồm" },
            "belong": { ipa: "/bɪˈlɒŋ/", pos: "v.", meaning: "thuộc về" },
            "belongs": { ipa: "/bɪˈlɒŋz/", pos: "v.", meaning: "thuộc về" },
            "include": { ipa: "/ɪnˈkluːd/", pos: "v.", meaning: "bao gồm" },
            "includes": { ipa: "/ɪnˈkluːdz/", pos: "v.", meaning: "bao gồm" },
            "represented": { ipa: "/ˌrep.rɪˈzen.tɪd/", pos: "v.", meaning: "được đại diện, phân bố" },
            "favour": { ipa: "/ˈfeɪ.vər/", pos: "v.", meaning: "ưa thích, thiên về" },
            "retain": { ipa: "/rɪˈteɪn/", pos: "v.", meaning: "giữ lại, duy trì" },
            "distinguish": { ipa: "/dɪˈstɪŋ.ɡwɪʃ/", pos: "v.", meaning: "phân biệt" },
            "describe": { ipa: "/dɪˈskraɪb/", pos: "v.", meaning: "mô tả" },
            "adapt": { ipa: "/əˈdæpt/", pos: "v.", meaning: "thích nghi, điều chỉnh" },
            "comprise": { ipa: "/kəmˈpraɪz/", pos: "v.", meaning: "bao gồm, gồm có" },
            "comprises": { ipa: "/kəmˈpraɪ.zɪz/", pos: "v.", meaning: "bao gồm" },
            "emerge": { ipa: "/ɪˈmɜːdʒ/", pos: "v.", meaning: "xuất hiện, nổi lên" },
            "gallop": { ipa: "/ˈɡæl.əp/", pos: "v., n.", meaning: "phi nước đại" },
            "gallops": { ipa: "/ˈɡæl.əps/", pos: "v.", meaning: "phi nước đại" },
            "numerous": { ipa: "/ˈnjuː.mər.əs/", pos: "adj.", meaning: "nhiều, đông đảo" },
            "complex": { ipa: "/ˈkɒm.pleks/", pos: "adj.", meaning: "phức tạp, phức hợp" },
            "social": { ipa: "/ˈsoʊ.ʃəl/", pos: "adj.", meaning: "xã hội, sống thành bầy đàn" },
            "important": { ipa: "/ɪmˈpɔː.tənt/", pos: "adj.", meaning: "quan trọng" },
            "common": { ipa: "/ˈkɒm.ən/", pos: "adj.", meaning: "phổ biến, thường thấy, chung" },
            "certain": { ipa: "/ˈsɜː.tən/", pos: "adj.", meaning: "chắc chắn, nhất định" },
            "necessary": { ipa: "/ˈnes.ə.ser.i/", pos: "adj.", meaning: "cần thiết" },
            "massive": { ipa: "/ˈmæs.ɪv/", pos: "adj.", meaning: "to lớn, đồ sộ" },
            "massively": { ipa: "/ˈmæs.ɪv.li/", pos: "adv.", meaning: "to lớn, ồ ạt" },
            "agile": { ipa: "/ˈædʒ.aɪl/", pos: "adj.", meaning: "nhanh nhẹn, linh hoạt" },
            "graceful": { ipa: "/ˈɡreɪs.fəl/", pos: "adj.", meaning: "duyên dáng, thanh nhã" },
            "slender": { ipa: "/ˈslen.dər/", pos: "adj.", meaning: "mảnh mai, thon" },
            "endangered": { ipa: "/ɪnˈdeɪn.dʒəd/", pos: "adj.", meaning: "có nguy cơ tuyệt chủng" },
            "rare": { ipa: "/reər/", pos: "adj.", meaning: "hiếm, quý hiếm" },
            "modified": { ipa: "/ˈmɒd.ɪ.faɪd/", pos: "adj.", meaning: "đã biến đổi, được thay đổi" },
            "undigested": { ipa: "/ˌʌn.daɪˈdʒes.tɪd/", pos: "adj.", meaning: "chưa tiêu hóa" },
            "exclusively": { ipa: "/ɪkˈskluː.sɪv.li/", pos: "adv.", meaning: "hoàn toàn, duy nhất, chỉ" },
            "typically": { ipa: "/ˈtɪp.ɪ.kəl.i/", pos: "adv.", meaning: "thường, theo cách điển hình" },
            "highly": { ipa: "/ˈhaɪ.li/", pos: "adv.", meaning: "rất, cao, ở mức cao" },
            "mainly": { ipa: "/ˈmeɪn.li/", pos: "adv.", meaning: "chủ yếu" },
            "generally": { ipa: "/ˈdʒen.ər.əl.i/", pos: "adv.", meaning: "nói chung, thường thì" },
            "greatly": { ipa: "/ˈɡreɪt.li/", pos: "adv.", meaning: "rất nhiều, lớn lao" },
            "freely": { ipa: "/ˈfriː.li/", pos: "adv.", meaning: "tự do" },
            "loosely": { ipa: "/ˈluːs.li/", pos: "adv.", meaning: "một cách lỏng lẻo, không chính xác" },
            "despite": { ipa: "/dɪˈspaɪt/", pos: "prep.", meaning: "mặc dù, bất chấp" },
            "although": { ipa: "/ɔːlˈðoʊ/", pos: "conj.", meaning: "mặc dù" },
            "whereas": { ipa: "/weərˈæz/", pos: "conj.", meaning: "trong khi, ngược lại" },
            "moreover": { ipa: "/mɔːˈroʊ.vər/", pos: "adv.", meaning: "hơn nữa, thêm vào đó" },
            "furthermore": { ipa: "/ˌfɜː.ðəˈmɔːr/", pos: "adv.", meaning: "hơn nữa, ngoài ra" },
            "therefore": { ipa: "/ˈðeə.fɔːr/", pos: "adv.", meaning: "vì vậy, do đó" },
            "majority": { ipa: "/məˈdʒɒr.ɪ.ti/", pos: "n.", meaning: "đa số, phần lớn" },
            "possession": { ipa: "/pəˈzeʃ.ən/", pos: "n.", meaning: "sự sở hữu, tài sản" },
            "appearance": { ipa: "/əˈpɪr.əns/", pos: "n.", meaning: "sự xuất hiện, ngoại hình" },
            "structure": { ipa: "/ˈstrʌk.tʃər/", pos: "n.", meaning: "cấu trúc, cơ cấu" },
            "structures": { ipa: "/ˈstrʌk.tʃərz/", pos: "n.", meaning: "các cấu trúc" },
            "feature": { ipa: "/ˈfiː.tʃər/", pos: "n.", meaning: "đặc điểm, tính năng" },
            "features": { ipa: "/ˈfiː.tʃərz/", pos: "n.", meaning: "các đặc điểm" },
            "development": { ipa: "/dɪˈvel.əp.mənt/", pos: "n.", meaning: "sự phát triển" },
            "range": { ipa: "/reɪndʒ/", pos: "n.", meaning: "phạm vi, dãy" },
            "differences": { ipa: "/ˈdɪf.ər.ən.sɪz/", pos: "n.", meaning: "sự khác biệt" },
            "island": { ipa: "/ˈaɪ.lənd/", pos: "n.", meaning: "đảo, hòn đảo" },
            "islands": { ipa: "/ˈaɪ.ləndz/", pos: "n.", meaning: "các hòn đảo" },
            "teeth": { ipa: "/tiːθ/", pos: "n.", meaning: "răng" },
            "horns": { ipa: "/hɔːnz/", pos: "n.", meaning: "sừng (số nhiều)" },
            "hooves": { ipa: "/huːvz/", pos: "n.", meaning: "các móng guốc" },
            "cloven": { ipa: "/ˈkloʊ.vən/", pos: "adj.", meaning: "chẻ đôi, chia đôi (móng)" },
            "stomachs": { ipa: "/ˈstʌm.əks/", pos: "n.", meaning: "các dạ dày" },
            "shoulder": { ipa: "/ˈʃoʊl.dər/", pos: "n.", meaning: "vai" },
            "rump": { ipa: "/rʌmp/", pos: "n.", meaning: "mông (động vật)" },
            "scrub": { ipa: "/skrʌb/", pos: "n.", meaning: "bụi rậm, cây bụi" },
            "desert": { ipa: "/ˈdez.ət/", pos: "n.", meaning: "sa mạc" },
            "deserts": { ipa: "/ˈdez.əts/", pos: "n.", meaning: "các sa mạc" },
            "forest": { ipa: "/ˈfɒr.ɪst/", pos: "n.", meaning: "rừng" },
            "swampy": { ipa: "/ˈswɒm.pi/", pos: "adj.", meaning: "đầm lầy, lầy lội" },
            "woolly": { ipa: "/ˈwʊl.i/", pos: "adj.", meaning: "có lông len, xù" },
            "precise": { ipa: "/prɪˈsaɪs/", pos: "adj.", meaning: "chính xác" },
            "erect": { ipa: "/ɪˈrekt/", pos: "adj., v.", meaning: "thẳng đứng, dựng lên" },
            "sole": { ipa: "/soʊl/", pos: "adj.", meaning: "duy nhất" },
            "mere": { ipa: "/mɪr/", pos: "adj.", meaning: "chỉ, chỉ là" },
            "marked": { ipa: "/mɑːkt/", pos: "adj.", meaning: "rõ rệt, đáng chú ý" },
            "flooded": { ipa: "/ˈflʌd.ɪd/", pos: "adj.", meaning: "bị ngập lụt" },
            "splayed": { ipa: "/spleɪd/", pos: "adj.", meaning: "xòe ra, bè ra" },
            "reduced": { ipa: "/rɪˈdjuːst/", pos: "adj.", meaning: "giảm bớt, suy giảm" },
            "alarmed": { ipa: "/əˈlɑːmd/", pos: "adj.", meaning: "hoảng sợ, báo động" },
            "carcasses": { ipa: "/ˈkɑː.kəs.ɪz/", pos: "n.", meaning: "xác chết động vật" },
            "insects": { ipa: "/ˈɪn.sekts/", pos: "n.", meaning: "côn trùng" },
            "enclosure": { ipa: "/ɪnˈkloʊ.ʒər/", pos: "n.", meaning: "vùng đất rào lại" },
            "relatives": { ipa: "/ˈrel.ə.tɪvz/", pos: "n.", meaning: "họ hàng, bà con" },
            "animals": { ipa: "/ˈæn.ɪ.məlz/", pos: "n.", meaning: "động vật" },
            "leaves": { ipa: "/liːvz/", pos: "n.", meaning: "lá cây" },
            "grass": { ipa: "/ɡrɑːs/", pos: "n.", meaning: "cỏ" },
            "foliage": { ipa: "/ˈfoʊ.li.ɪdʒ/", pos: "n.", meaning: "tán lá" },
            "cropped": { ipa: "/krɒpt/", pos: "v.", meaning: "cắt ngắn, gặm" },
            "renewed": { ipa: "/rɪˈnjuːd/", pos: "adj.", meaning: "được đổi mới, mọc lại" },
            "unbranched": { ipa: "/ˌʌnˈbrɑːntʃt/", pos: "adj.", meaning: "không phân nhánh" },
            "sheath": { ipa: "/ʃiːθ/", pos: "n.", meaning: "bao, vỏ bọc" },
            "incisors": { ipa: "/ɪnˈsaɪ.zərz/", pos: "n.", meaning: "răng cửa" },

            // === COMMON PHRASES (multi-word) ===
            "well represented": { ipa: "/ˌwel ˌrep.rɪˈzen.tɪd/", pos: "adj. phr.", meaning: "được đại diện nhiều, phân bố rộng" },
            "wide range": { ipa: "/waɪd reɪndʒ/", pos: "n. phr.", meaning: "phạm vi rộng, đa dạng" },
            "open grassland": { ipa: "/ˈoʊ.pən ˈɡrɑːs.lænd/", pos: "n. phr.", meaning: "đồng cỏ mở, thảo nguyên" },
            "social structures": { ipa: "/ˈsoʊ.ʃəl ˈstrʌk.tʃərz/", pos: "n. phr.", meaning: "cấu trúc xã hội, tổ chức bầy đàn" },
            "domestic animals": { ipa: "/dəˈmes.tɪk ˈæn.ɪ.məlz/", pos: "n. phr.", meaning: "động vật nuôi, gia súc" },
            "domestic cattle": { ipa: "/dəˈmes.tɪk ˈkæt.əl/", pos: "n. phr.", meaning: "gia súc nuôi" },
            "common features": { ipa: "/ˈkɒm.ən ˈfiː.tʃərz/", pos: "n. phr.", meaning: "đặc điểm chung" },
            "tropical forest": { ipa: "/ˈtrɒp.ɪ.kəl ˈfɒr.ɪst/", pos: "n. phr.", meaning: "rừng nhiệt đới" },
            "arctic tundra": { ipa: "/ˈɑːk.tɪk ˈtʌn.drə/", pos: "n. phr.", meaning: "lãnh nguyên Bắc Cực" },
            "highly modified": { ipa: "/ˈhaɪ.li ˈmɒd.ɪ.faɪd/", pos: "adj. phr.", meaning: "được biến đổi nhiều" },
            "exclusively herbivorous": { ipa: "/ɪkˈskluː.sɪv.li hɜːˈbɪv.ər.əs/", pos: "adj. phr.", meaning: "hoàn toàn ăn cỏ" },
            "highly diverse": { ipa: "/ˈhaɪ.li daɪˈvɜːs/", pos: "adj. phr.", meaning: "rất đa dạng" },
            "large groups": { ipa: "/lɑːdʒ ɡruːps/", pos: "n. phr.", meaning: "nhóm lớn, bầy đàn lớn" },
            "full flight": { ipa: "/fʊl flaɪt/", pos: "n. phr.", meaning: "chạy hết tốc lực" },
            "natural selection": { ipa: "/ˈnætʃ.ər.əl sɪˈlek.ʃən/", pos: "n.", meaning: "chọn lọc tự nhiên" },
            "water buffalo": { ipa: "/ˈwɔː.tər ˈbʌf.ə.loʊ/", pos: "n.", meaning: "trâu nước" },
            "long-legged": { ipa: "/ˌlɒŋˈleɡ.ɪd/", pos: "adj.", meaning: "chân dài" },
            "fast-running": { ipa: "/ˌfɑːstˈrʌn.ɪŋ/", pos: "adj.", meaning: "chạy nhanh" },
            "non-territorial": { ipa: "/ˌnɒn.ter.ɪˈtɔː.ri.əl/", pos: "adj.", meaning: "không chiếm lãnh thổ" },
            "mountain-dwellers": { ipa: "/ˈmaʊn.tɪn ˈdwel.ərz/", pos: "n.", meaning: "sinh vật sống trên núi" },
            "sub-family": { ipa: "/ˈsʌbˌfæm.ɪ.li/", pos: "n.", meaning: "phân họ" },
            "deep water": { ipa: "/diːp ˈwɔː.tər/", pos: "n. phr.", meaning: "nước sâu" },
            "white patch": { ipa: "/waɪt pætʃ/", pos: "n. phr.", meaning: "mảng trắng" },
            "bony cores": { ipa: "/ˈboʊ.ni kɔːrz/", pos: "n. phr.", meaning: "lõi xương" },
            "horny material": { ipa: "/ˈhɔːr.ni məˈtɪr.i.əl/", pos: "n. phr.", meaning: "chất sừng" },
            "cheek teeth": { ipa: "/tʃiːk tiːθ/", pos: "n. phr.", meaning: "răng hàm" }
        };
    }

    getIPA(word) {
        if (!word) return "/.../";
        const cleanWord = word.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
        if (this.dict[cleanWord]) return this.dict[cleanWord].ipa;
        // Try with hyphens preserved
        const withHyphens = word.trim().toLowerCase();
        if (this.dict[withHyphens]) return this.dict[withHyphens].ipa;
        return this._estimateIPA(cleanWord);
    }

    /**
     * True only when the word has a REAL, curated dictionary entry (with an
     * accurate IPA). Returns false when getIPA() would fall back to the rough
     * _estimateIPA() heuristic — the caller can then fetch a correct IPA from AI.
     */
    hasRealEntry(word) {
        if (!word) return false;
        const cleanWord = word.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
        if (this.dict[cleanWord]) return true;
        const withHyphens = word.trim().toLowerCase();
        return !!this.dict[withHyphens];
    }

    getPOS(word, sentence = '') {
        if (!word) return 'n.';
        const clean = word.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
        if (!clean) return 'n.';
        if (this.dict[clean]) return this.dict[clean].pos;
        const withHyphens = word.trim().toLowerCase();
        if (this.dict[withHyphens]) return this.dict[withHyphens].pos;

        // Fast functional & closed-class word bank
        const FAST_POS = {
            'i': 'pron.', 'you': 'pron.', 'he': 'pron.', 'she': 'pron.', 'it': 'pron.',
            'we': 'pron.', 'they': 'pron.', 'me': 'pron.', 'him': 'pron.', 'her': 'pron.',
            'us': 'pron.', 'them': 'pron.', 'my': 'pron.', 'your': 'pron.', 'his': 'pron.',
            'their': 'pron.', 'our': 'pron.', 'this': 'pron.', 'that': 'pron.', 'these': 'pron.',
            'those': 'pron.', 'who': 'pron.', 'whom': 'pron.', 'whose': 'pron.', 'which': 'pron.',
            'what': 'pron.', 'myself': 'pron.', 'yourself': 'pron.', 'himself': 'pron.',
            'in': 'prep.', 'on': 'prep.', 'at': 'prep.', 'to': 'prep.', 'for': 'prep.',
            'with': 'prep.', 'by': 'prep.', 'from': 'prep.', 'about': 'prep.', 'into': 'prep.',
            'through': 'prep.', 'over': 'prep.', 'under': 'prep.', 'between': 'prep.',
            'against': 'prep.', 'during': 'prep.', 'without': 'prep.', 'before': 'prep.',
            'after': 'prep.', 'above': 'prep.', 'below': 'prep.', 'across': 'prep.',
            'and': 'conj.', 'but': 'conj.', 'or': 'conj.', 'nor': 'conj.', 'so': 'conj.',
            'yet': 'conj.', 'because': 'conj.', 'although': 'conj.',
            'while': 'conj.', 'if': 'conj.', 'unless': 'conj.', 'since': 'conj.',
            'is': 'v.', 'am': 'v.', 'are': 'v.', 'was': 'v.', 'were': 'v.',
            'be': 'v.', 'been': 'v.', 'being': 'v.', 'have': 'v.', 'has': 'v.',
            'had': 'v.', 'do': 'v.', 'does': 'v.', 'did': 'v.', 'can': 'v.',
            'could': 'v.', 'will': 'v.', 'would': 'v.', 'shall': 'v.', 'should': 'v.',
            'may': 'v.', 'might': 'v.', 'must': 'v.', 'get': 'v.', 'got': 'v.',
            'make': 'v.', 'made': 'v.', 'go': 'v.', 'went': 'v.', 'gone': 'v.',
            'take': 'v.', 'took': 'v.', 'see': 'v.', 'saw': 'v.', 'seen': 'v.',
            'know': 'v.', 'knew': 'v.', 'known': 'v.', 'think': 'v.', 'thought': 'v.',
            'very': 'adv.', 'too': 'adv.', 'so': 'adv.', 'quite': 'adv.', 'just': 'adv.',
            'already': 'adv.', 'always': 'adv.', 'never': 'adv.', 'often': 'adv.',
            'sometimes': 'adv.', 'usually': 'adv.', 'virtually': 'adv.', 'really': 'adv.',
            'also': 'adv.', 'almost': 'adv.', 'even': 'adv.', 'now': 'adv.', 'then': 'adv.',
            'here': 'adv.', 'there': 'adv.', 'away': 'adv.', 'back': 'adv.'
        };
        if (FAST_POS[clean]) return FAST_POS[clean];

        // Suffix Rules
        if (clean.endsWith('ly')) return 'adv.';
        if (clean.endsWith('ous') || clean.endsWith('ious') || clean.endsWith('eous') ||
            clean.endsWith('ic') || clean.endsWith('ical') || clean.endsWith('al') ||
            clean.endsWith('ive') || clean.endsWith('ful') || clean.endsWith('less') ||
            clean.endsWith('able') || clean.endsWith('ible') || clean.endsWith('ish') ||
            clean.endsWith('ent') || clean.endsWith('ant') || clean.endsWith('ary')) {
            return 'adj.';
        }
        if (clean.endsWith('tion') || clean.endsWith('sion') || clean.endsWith('ment') ||
            clean.endsWith('ness') || clean.endsWith('ity') || clean.endsWith('ance') ||
            clean.endsWith('ence') || clean.endsWith('er') || clean.endsWith('or') ||
            clean.endsWith('ship') || clean.endsWith('ism') || clean.endsWith('ist') ||
            clean.endsWith('logy') || clean.endsWith('graphy') || clean.endsWith('th')) {
            return 'n.';
        }
        if (clean.endsWith('ize') || clean.endsWith('ise') || clean.endsWith('fy') ||
            clean.endsWith('ate') || clean.endsWith('ed') || clean.endsWith('ing')) {
            return 'v.';
        }

        // Sentence Syntax Rules
        if (sentence) {
            const lowerSent = sentence.toLowerCase();
            const wordsInSent = lowerSent.match(/[a-z'-]+/g) || [];
            const idx = wordsInSent.indexOf(clean);
            if (idx > 0) {
                const prev = wordsInSent[idx - 1];
                if (['is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'became', 'seems', 'virtually', 'extremely', 'very', 'quite'].includes(prev)) {
                    return 'adj.';
                }
                if (['a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their'].includes(prev)) {
                    return 'n.';
                }
                if (prev === 'to') return 'v.';
            }
        }

        return 'n.';
    }

    /**
     * Get Vietnamese meaning for a word/phrase. Returns null if not found.
     */
    getMeaning(word) {
        if (!word) return null;
        const cleanWord = word.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
        if (this.dict[cleanWord]) return this.dict[cleanWord].meaning;
        const withHyphens = word.trim().toLowerCase();
        if (this.dict[withHyphens]) return this.dict[withHyphens].meaning;
        return null;
    }

    _estimateIPA(word) {
        if (!word) return "/.../";
        // Single, comprehensive rule-based phonetic transcription for English
        // words NOT covered by the curated dictionary. Not perfect, but FAR more
        // accurate than the previous few-rule heuristic, and ALWAYS returns a
        // non-empty IPA so the user sees something plausible rather than the
        // raw word echoed back. For best results the caller should still ask AI
        // for an accurate IPA when possible.
        const w = word.toLowerCase().replace(/[^a-z'-]/g, '');
        if (!w) return "/.../";

        // Mark syllable boundaries by inserting '·' before vowel groups.
        const V = 'aeiouy';
        const isVowel = (ch) => V.includes(ch);
        const isConsonant = (ch) => !isVowel(ch) && /[a-z]/.test(ch);
        // Insert '.' before each new vowel group (skip first vowel).
        let marked = '';
        let prevVowel = false;
        for (let i = 0; i < w.length; i++) {
            const ch = w[i];
            if (isVowel(ch)) {
                if (!prevVowel && marked.length > 0 && marked[marked.length - 1] !== '.') {
                    marked += '·';
                }
                prevVowel = true;
            } else {
                prevVowel = false;
            }
            marked += ch;
        }

        // Apply digraph/trigraph → phonetic substitutions.
        let p = marked
            // Common consonant digraphs/trigraphs
            .replace(/ph/g, 'f')
            .replace(/th/g, 'θ')
            .replace(/sh/g, 'ʃ')
            .replace(/ch/g, 'tʃ')
            .replace(/wh/g, 'w')
            .replace(/gh(?=[aeiou])/g, '')        // silent gh
            .replace(/gh/g, 'g')
            .replace(/ck/g, 'k')
            .replace(/qu/g, 'kw')
            .replace(/ng/g, 'ŋ')
            .replace(/nk/g, 'ŋk')
            // 'c' rules
            .replace(/c(?=[eiy])/g, 's')
            .replace(/c/g, 'k')
            // 'g' rules (mostly silent e, but rough)
            .replace(/g(?=[eiy])/g, 'ɡ')
            .replace(/g/g, 'ɡ')
            // 'x' rules
            .replace(/x/g, 'ks')
            // Silent letters
            .replace(/e\b/g, '')
            .replace(/([bcdfɡhlmnprstwz])·/g, '$1')   // collapse stray dot after consonant
            // Vowel teams (long vowels)
            .replace(/ee/g, 'iː')
            .replace(/ea/g, 'iː')
            .replace(/ie/g, 'iː')
            .replace(/y(?=·|$)/g, 'aɪ')
            .replace(/oo/g, 'uː')
            .replace(/ou/g, 'aʊ')
            .replace(/ow/g, 'aʊ')
            .replace(/oi/g, 'ɔɪ')
            .replace(/oy/g, 'ɔɪ')
            .replace(/au/g, 'ɔː')
            .replace(/aw/g, 'ɔː')
            .replace(/ai/g, 'eɪ')
            .replace(/ay/g, 'eɪ')
            .replace(/ey/g, 'eɪ')
            .replace(/oa/g, 'oʊ')
            .replace(/oe/g, 'oʊ')
            .replace(/ue/g, 'uː')
            // Schwa for unstressed single vowels
            .replace(/a(?=·)/g, 'ə')
            .replace(/e(?=·)/g, 'ə')
            .replace(/i(?=·)/g, 'ɪ')
            .replace(/o(?=·)/g, 'ə')
            .replace(/u(?=·)/g, 'ə')
            // Suffixes
            .replace(/tion/g, 'ʃən')
            .replace(/sion/g, 'ʒən')
            .replace(/ture/g, 'tʃər')
            .replace(/ing/g, 'ɪŋ')
            .replace(/ed$/g, 'd')
            .replace(/s$/g, 'z')
            .replace(/·/g, '');

        // Final cleanup: collapse doubled IPA letters that sometimes appear.
        p = p.replace(/([ɪɛæɑɒɔʊʌəɜ])ːː/g, '$1ː');

        return `/${p || '.../'}`;
    }
}

window.dictionaryDB = new DictionaryDB();
