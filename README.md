# 🌐 LinguaContext Pro — RealTime Text Translating

[![Stars](https://img.shields.io/github/stars/Kenkra9999/RealTime_TextTranslating?style=for-the-badge&logo=github)](https://github.com/Kenkra9999/RealTime_TextTranslating/stargazers)
[![Forks](https://img.shields.io/github/forks/Kenkra9999/RealTime_TextTranslating?style=for-the-badge&logo=github)](https://github.com/Kenkra9999/RealTime_TextTranslating/network/members)
[![License](https://img.shields.io/github/license/Kenkra9999/RealTime_TextTranslating?style=for-the-badge)](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/.gitignore)
[![Language](https://img.shields.io/github/languages/top/Kenkra9999/RealTime_TextTranslating?style=for-the-badge&logo=javascript)](https://github.com/Kenkra9999/RealTime_TextTranslating)

> **Ứng dụng web dịch thuật ngữ cảnh theo thời gian thực** — tra từ điển, ghi chú từ vựng và xuất PDF chuyên nghiệp.

---

## 🔗 Truy Cập Nhanh

| 🌟 Thứ Bạn Cần | Link |
|---|---|
| 🚀 **Xem Website Demo** | [kenkra9999.github.io/TextTranslating](https://kenkra9999.github.io/TextTranslating/) |
| 📦 **Mã Nguồn Repo Này** | [github.com/Kenkra9999/RealTime_TextTranslating](https://github.com/Kenkra9999/RealTime_TextTranslating) |
| 📂 **File `index.html` (chạy app)** | [Mở ngay ➜](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/index.html) |
| 📜 **Lịch Sử Commit** | [Xem ➜](https://github.com/Kenkra9999/RealTime_TextTranslating/commits/main/) |
| ⚖️ **Repo cũ (cũ)** | [Kenkra9999/TextTranslating](https://github.com/Kenkra9999/TextTranslating) |

---

## 📁 Cấu Trúc Dự Án (Nhấp Vào Để Mở Code)

```
RealTime_TextTranslating/
│
├── 📄 index.html              ⬅ FILE CHẠY CHÍNH
├── 📘 README.md               ⬄ File này
├── 🙈 .gitignore
│
├── 📂 css/                    ⬅ Mở folder này
│   └── style.css
│
├── 📂 js/                     ⬅ Mở folder này (chứa toàn bộ logic)
│   ├── app.js                 ⬅ File JS chính (3340 dòng)
│   ├── dictionary-db.js       ⬅ Cơ sở dữ liệu từ điển
│   ├── highlighter.js         ⬅ Logic tô sáng văn bản song ngữ
│   ├── pdf-exporter.js        ⬅ Xuất báo cáo PDF
│   └── translator.js          ⬅ Bộ máy dịch thuật
│
├── 📂 .agents/                ⬅ Cấu hình Agent (nâng cao)
└── 📂 .cursor/                ⬅ Cấu hình Cursor IDE
```

### 🖱️ Các Link Mở Nhanh Tới Code

| File | Mô Tả | Mở Code |
|------|-------|---------|
| `index.html` | Giao diện chính | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/index.html) |
| `css/style.css` | Stylesheet chính | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/css/style.css) |
| `js/app.js` | Logic ứng dụng | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/js/app.js) |
| `js/dictionary-db.js` | Database từ điển | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/js/dictionary-db.js) |
| `js/highlighter.js` | Tô sáng song ngữ | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/js/highlighter.js) |
| `js/pdf-exporter.js` | Xuất PDF | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/js/pdf-exporter.js) |
| `js/translator.js` | Engine dịch | [📖 Mở](https://github.com/Kenkra9999/RealTime_TextTranslating/blob/main/js/translator.js) |

---

## 🚀 Giới Thiệu

**LinguaContext Pro** là ứng dụng web dịch thuật thời gian thực với các tính năng:

- 🔤 **Dịch thuật & tra từ** theo ngữ cảnh, hiển thị từ loại
- 📝 **Ghi chú & lưu từ** kèm ví dụ cá nhân
- 📄 **Xuất PDF** chuyên nghiệp với highlight song ngữ
- 🎨 **Giao diện hiện đại**, hỗ trợ Dark/Light mode
- 📱 **Responsive** trên cả iOS & Android

## ✨ Tính Năng Nổi Bật

- ✅ Tô sóng ngữ song ngữ 1 lượt
- ✅ Tích hợp CodeGraph tìm kiếm thông minh
- ✅ Tải PDF bold, pastel Vietnamese highlights
- ✅ Microsoft Edge UTF-8 Blob & In-Page Modal support
- ✅ Custom font, word-spacing cho PDF
- ✅ Mobile touch optimizations

## 🛠️ Cách Chạy Local

```bash
# Cách 1: Mở trực tiếp
double-click index.html

# Cách 2: Dùng live server (khuyến nghị)
npx serve .
# Mở http://localhost:3000

# Cách 3: Dùng Python
python -m http.server 8000
# Mở http://localhost:8000
```

## 🤝 Đóng Góp

1. Fork repo này
2. Tạo branch mới (`git checkout -b feature/AmazingFeature`)
3. Commit (`git commit -m 'Add some AmazingFeature'`)
4. Push (`git push origin feature/AmazingFeature`)
5. Tạo Pull Request

## 📞 Liên Hệ

- 👤 **Tác giả**: [@Kenkra9999](https://github.com/Kenkra9999)
- 🐛 **Báo lỗi**: [Issues](https://github.com/Kenkra9999/RealTime_TextTranslating/issues)

---

⭐ Nếu thấy hữu ích, hãy star repo để ủng hộ nhé!
