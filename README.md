# 🤝 IG Auto Follow — Chrome Extension

Otomatik Instagram takip, takipçi analizi ve **otomatik takipten çıkma** işlemlerini destekleyen Chrome uzantısı.

---

## 🚀 Kurulum

1. Bu repoyu indirin veya klonlayın.
2. Chrome'da `chrome://extensions/` adresine gidin.
3. **Geliştirici modu**nu etkinleştirin.
4. **Paketlenmemiş uzantı yükle** ile klasörü seçin.

---

## ✨ Özellikler

### 👥 Takipçi / ❤️ Beğenenler Sekmesi
- Instagram'daki takipçi veya beğeni modalını açarak kullanıcı listesini otomatik tarar.
- Blacklist'e eklenen kullanıcıları atlar.
- Min/max gecikme, ardışık hata limiti ve oturum limiti ile kontrollü çalışır.
- Kaldığı yerden devam etme (scroll resume) desteği.

### 📊 Analiz Sekmesi
- Kendi profilinizdeki "Takipçiler" modalını tarayarak karşılıklı takip ve karşılıksız takipçileri sınıflandırır.

### 👻 Geri Takip Sekmesi
- "Takip Edilenler" modalını tarayarak sizi geri takip etmeyen kullanıcıları listeler.
- **Otomatik Takipten Çıkma akışı** ile bu listedeki kullanıcılardan toplu takipten çıkabilirsiniz.

### 🚫 Otomatik Takipten Çıkma (v3.3.0)
Geri Takip sekmesinde "Takip Edilenler" taramasını tamamladıktan sonra kullanılır:

1. Instagram'da kendi profilinizin **Takip Edilenler** modalını açın.
2. Uzantıda **Geri Takip** sekmesine geçin ve taramayı başlatın.
3. (İsteğe bağlı) Analiz sekmesinde takipçi taraması da yapın; bu, karşılıklı hesapların yanlışlıkla takipten çıkarılmamasını sağlar.
4. Sonuçlar göründükten sonra **Takipten Çıkmayı Başlat** düğmesine basın.
5. Akış modal açıkken her kullanıcıya scroll yaparak "Takipte" düğmesine tıklar ve varsa onay diyaloğunu otomatik kabul eder.

**Güvenli kullanım için öneriler:**
- Varsayılan oturum limiti (50) bilinçli olarak düşük tutulmuştur. Günlük 50–100'den fazla işlem hesap askıya alınma riskini artırır.
- Beyaz listeye (Whitelist) korumak istediğiniz hesapları ekleyin; bu hesaplara hiçbir zaman takipten çıkma işlemi uygulanmaz.
- Akışlar arasında birkaç saat beklemeniz önerilir.

### 📋 Günlük Sekmesi
- **Whitelist**: Takipten çıkma akışında asla işleme alınmayacak kullanıcılar.
- **Blacklist**: Takip akışında atlanan kullanıcılar; başarısız işlemlerde otomatik eklenir.
- Tüm aktiviteler zaman damgalı olarak kayıt altına alınır.

---

## ⚠️ Uyarı

Bu uzantı, Instagram'ın otomasyon politikalarına aykırı işlemler gerçekleştirebilir. Kontrollü ve ölçülü kullanım önerilir — aşırı kullanım hesabınızın geçici veya kalıcı olarak askıya alınmasına neden olabilir.

---

## 📦 Sürüm Geçmişi

| Sürüm | Özellik |
|-------|---------|
| v3.3.0 | Otomatik Takipten Çıkma akışı, Whitelist desteği |
| v3.2.0 | Analiz sekmesi, Geri Takip sekmesi, scroll resume |
| v3.1.x | Blacklist, oturum limiti, ardışık hata koruması |
