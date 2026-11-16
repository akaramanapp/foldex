# Foldex — Proje Planı

## Bağlam

Yapay zekayla bilgisayarda onlarca, yüzlerce proje birikiyor ve hangisinin ne yaptığı unutuluyor. Foldex bunu, kullanıcının IDE'sine (Cursor, Claude Code vb.) tek bir config satırıyla eklenen bir MCP sunucusuyla çözecek:

- Projeler açıldıkları anda otomatik olarak kaydedilir.
- Özetleri, kullanıcının zaten kullandığı model yazar.
- Her şey aranabilir tek bir HTML sayfasında toplanır.

Tasarım kararları [docs/design-notes.md](docs/design-notes.md) dosyasında. Bugünkü durum:

- `foldex-mcp@0.0.1` npm'de yer tutucu olarak yayında (`foldex` adı npm'in benzerlik kuralı yüzünden alınamadı).
- Repoda sadece `package.json`, `README.md`, `bin/foldex.js` ve tasarım notları var. Gerçek kod yok.

**Hedef:** İlk kullanılabilir sürüm olan `0.1.0`'ı (MVP) yayınlamak. Sonraki sürümler aşağıda yol haritası olarak duruyor.

## Teknik kararlar

- **Dil ve çalışma ortamı:** TypeScript, Node ≥ 18. Dağıtım `npx -y foldex-mcp <kök klasörler…>` ile yapılır.
- **Bağımlılıklar:** Sadece `@modelcontextprotocol/sdk` (şu an 1.32.x) ve `zod`. Derleme `tsup` ile, testler `vitest` ile yapılır. Veritabanı, dosya izleyici ve embedding kullanılmaz.
- **Veri:** `~/.foldex/projects.json` dosyası. Anahtar projenin mutlak yoludur. Saklanan alanlar: özet, etiketler, durum, oluşturulma tarihi, kaynak IDE, git remote, `missing` bayrağı. Yazma işlemi atomiktir (önce `projects.json.tmp`'ye yazılır, sonra `rename` edilir).
- **Canlı veri:** Teknolojiler, README'nin ilk paragrafı ve son commit tarihi saklanmaz; her araç çağrısında yeniden okunur.
- **Proje tespiti:** Bir klasör şu dosyalardan birini içeriyorsa projedir: `.git`, `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.csproj`. Eşleşme bulununca alt klasörlere inilmez. Kök klasörlerde en fazla 3 seviye derine bakılır. `node_modules`, `.venv` ve gizli klasörler atlanır.
- **Açılışta otomatik kayıt:** Sunucu başlayınca istemci destekliyorsa `roots/list` ile açık klasörler alınır. Desteklemiyorsa sunucunun çalıştığı dizin (`process.cwd()`) kullanılır, ama bu dizin ev dizini ya da `/` ise atlanır. Bulunan klasör proje ise ve kayıtlı değilse "özetsiz" olarak eklenir.

## Dosya yapısı

```
src/
  index.ts     # giriş noktası: argümanları ayrıştırır; "open" alt komutu ya da MCP sunucusu
  server.ts    # McpServer, instructions metni, araç tanımları
  scan.ts      # kök klasör taraması, proje tespiti, README/manifest/git meta verisi
  store.ts     # ~/.foldex/projects.json okuma, birleştirme, atomik yazma
  register.ts  # açılışta roots / cwd ile otomatik kayıt
  html.ts      # tek dosyalık index.html üretimi (gömülü CSS/JS, arama ve filtre)
test/          # vitest, geçici klasörlerle
```

`package.json` → `bin: { "foldex-mcp": "dist/index.js" }`. `bin/foldex.js` yer tutucusu kaldırılır.

## Aşamalar

### Aşama 0 — Kurulum ve doğrulama deneyi
- TypeScript, tsup, vitest ve MCP SDK kurulur. Boş bir MCP sunucusu Claude Code'a ve Cursor'a eklenir.
- **Kritik deney:** Cursor'ın sunucuyu hangi dizinde başlattığı ve `roots` desteği olup olmadığı denenir. Sonuç design-notes'a yazılır. Cursor ikisini de sağlamıyorsa otomatik kayıt orada modelin `update_project` çağrısına kalır (kök tarama yine güvenlik ağıdır).

### Aşama 1 — Çekirdek: tarama ve kayıt (`scan.ts`, `store.ts`)
- Proje tespiti ve meta veri okuma: ad, README'nin ilk paragrafı, `package.json`/`pyproject.toml` açıklaması, teknolojiler, son commit tarihi (`git log -1 --format=%cI`, git yoksa klasörün değişiklik tarihi), remote.
- Kayıt ile taramanın birleştirilmesi: yolu artık bulunmayan kayıtlara `missing` işareti konur, kayıt silinmez.
- Birim testleri: geçici klasörlerde örnek projeler, iç içe projeler, atomik yazma.

### Aşama 2 — MCP sunucusu (`server.ts`, `register.ts`)
- Araçlar:
  - `list_projects(filter?)`: proje başına tek satırlık kompakt liste; özeti eksik olanlar işaretli.
  - `get_project(path|name)`: tek bir projenin ayrıntıları.
  - `update_project(path, summary, tags?, status?)`: kayıt oluşturur ya da günceller.
  - `list_pending`: özeti eksik projeler.
- `instructions` ve araç açıklamaları: yeni proje oluşturunca `update_project` çağrılır; önemli bir değişiklikte özet güncellenir; yeni bir işe başlamadan önce `list_projects` ile benzer bir proje var mı bakılır.
- Açılışta otomatik kayıt. Her yazmadan sonra HTML yeniden üretilir.

### Aşama 3 — HTML sayfası (`html.ts`)
- `~/.foldex/index.html`: arama kutusu, durum ve teknoloji filtreleri, proje kartları. Her kartta özet, teknolojiler, son değişiklik, yol, `cursor://` / `vscode://` linkleri ve "özetsiz" ile "bulunamadı" rozetleri yer alır.
- Deneme projeleri varsayılan olarak ayrı filtrede gösterilir.

### Aşama 4 — Yayın (`0.1.0`)
- README: tek satırlık kurulum (Cursor JSON'u ve `claude mcp add`), mahremiyet notu (hiçbir veri makineden çıkmaz), örnek sorular, ekran görüntüsü.
- GitHub reposu ve MIT lisansı eklenir, `npm publish` yapılır (2FA kodu kullanıcıda).

### Sonraki sürümler (MVP dışı)
- `0.2`: `search_projects`, `npx foldex-mcp open` (sayfayı yeniden üretip tarayıcıda açar), MCP prompt'ları.
- `0.3`: taşınan projeleri remote üzerinden eşleştirme, uzun süre dokunulmayan denemeleri otomatik arşiv görünümüne alma, aynı remote'a sahip kopyaları gruplama.
- Tanıtım: `foldex.sh` ya da GitHub Pages, awesome-mcp-servers ve Glama listelerine ekleme.

## Doğrulama

1. `npm test`: tarama, kayıt birleştirme ve atomik yazma testleri geçer.
2. **MCP Inspector:** `npx @modelcontextprotocol/inspector node dist/index.js <test-klasörü>` ile her araç elle çağrılır ve `~/.foldex/projects.json` içeriği kontrol edilir.
3. **Claude Code:** `claude mcp add foldex -- node <repo>/dist/index.js ~/projects` ile eklenir. Yeni bir klasörde oturum açılır ve otomatik kaydın gerçekleştiği görülür. Sonra "küçük bir CSV birleştirme scripti yap" denir ve modelin `update_project` çağırıp çağırmadığına bakılır.
4. **Cursor:** Aynı senaryo tekrarlanır (Aşama 0 deneyinin sonucuna göre).
5. `~/.foldex/index.html` tarayıcıda açılır; arama, filtreler ve "Cursor'da aç" linki kontrol edilir.
6. Yayından önce `npm pack --dry-run` ile paket içeriği kontrol edilir. Yayından sonra temiz bir dizinde `npx -y foldex-mcp` ile kurulum denenir.
