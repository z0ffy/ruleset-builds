感谢 [SukkaW](https://github.com/SukkaW) 的开源贡献与持续维护。

GitHub Release 提供以下产物，均基于同一份上游规则及 `rules/local/download.yaml` 本地补充规则生成：

- `download.yaml`：Mihomo domain 规则集源文件。
- `download.mrs`：Mihomo 二进制规则集。
- `download.srs`：sing-box 二进制规则集（规则集版本 2，适用于 sing-box 1.10 及以上版本）。
- `checksums.txt`：以上文件的 SHA-256 校验和。

本地生成 SRS（需要 Node.js 24 和 sing-box）：

```sh
mkdir -p dist
node scripts/convert-sing-box.ts --input rules/domain/download.yaml --output dist/download.json
sing-box rule-set compile --output dist/download.srs dist/download.json
```

转换支持精确域名和 `+.example.com`（根域名及其子域名）；遇到其他模式会报错，避免改变匹配语义。
