---
title: "从零到一：基于 small-rpc 实战将 Java 开源库发布到 Maven 中央仓库（Central Portal 最新规范）"
description: "详解 Sonatype Central Portal 全新规范：Namespace 认证、GPG 签名分发、POM 合规配置，以及基于 small-rpc 的多模块排除与发布避坑实战。"
publishDate: 2026-10-18
tags: ["Maven", "开源实战"]
readTime: "约 9 分钟"
series:
  name: "SMALL-RPC 从零到治理闭环"
  order: 3
refLink:
  text: "参考工程：small-rpc"
  url: "https://github.com/upowerman/small-rpc"
---

对于 Java 开发者而言，把自研的基础库、工具包或者微服务框架发布到 **Maven 中央仓库（Maven Central Repository）**，让全球开发者只需在 `pom.xml` 里添加一段 `` 就能开箱即用，是开源项目走向工业级成熟的重要里程碑。

我在开发轻量级微内核 RPC 框架 **[small-rpc](https://github.com/upowerman/small-rpc)** 2.0 时，全仓多个子模块（如 `small-rpc-spring-boot-starter`）均正式通过了 Maven Central 发布。然而，网上的大部分教程还停留在多年前的**老旧方案**（去 Sonatype Jira 提工单等待管理员人工审核、配置已被弃用的 `nexus-staging-maven-plugin` 等）。

如今，Sonatype 官方已全面升级为现代化的 **Central Portal（中央发布门户）**。本文将基于 `small-rpc` 项目的实操经验，手把手带你用**最新的官方发布链路与自动化插件**，避开多模块工程、版本兼容等所有暗坑，顺畅完成全流程发布。

## 一、为什么采用 Central Portal 新规范？

在旧规范时代，发布流程非常冗长：你需要在 `issues.sonatype.org` 注册 Jira 账号，建 Issue 申请 GroupId，等待人工审核确认；发包时还要使用配置极其繁杂的 `nexus-staging-maven-plugin`，一旦有签名或 Javadoc 格式微小瑕疵，只能在 Nexus 控制台抓瞎排查。

而在新的 **Sonatype Central Portal** 体系下：

- **自主秒级认证**：通过 GitHub 临时仓库或 DNS TXT 记录，系统自动校验域名/账号所有权，无需等待人工审查；
- **现代化官方插件**：官方推出专用的 `central-publishing-maven-plugin`，原生接入 Central Portal API；
- **可视化校验控制台**：包上传后，Portal 会在网页端给出明确的逐项校验反馈（POM 合规、签名、Javadoc、源码完整性等），一目了然。

## 二、第一步：注册 Central Portal 与验证命名空间（Namespace）

首先访问中央仓库官方发布门户：[https://central.sonatype.com/](https://central.sonatype.com/)。

### 1. 注册与登录

推荐直接使用 **Sign in with GitHub** 授权登录。这不仅方便后续账号管理，还能简化基于 GitHub 的 Namespace 认证流程。

### 2. 申请并验证 Namespace（GroupId）

Namespace 对应 Maven 依赖坐标中的 `groupId`。通常有两种形式：

- **自主顶级域名**：如 `top.yunitytech`、`com.yourdomain`，需要在域名解析控制台添加一条 TXT 记录完成所有权验证；
- **GitHub 账号命名空间**：格式固定为 `io.github.`。例如我的 GitHub 用户名是 `upowerman`，则申请的命名空间为 `io.github.upowerman`。

以 `io.github.upowerman` 为例，点击 **Add Namespace** 后，平台会给出一个唯一的 Verification Key（例如 `verification-key-1a2b3c...`）。验证步骤极其简单：

1. 登录你的 GitHub，新建一个**公开仓库（Public Repository）**，仓库名称直接命名为该 Verification Key；
2. 回到 Central Portal，点击 **Verify Namespace** 按钮；
3. 后台机器人会自动请求 `https://github.com/upowerman/`，只要检测到该公开仓库存在，几秒钟内便会显示已验证通过；
4. 验证成功后，即可放心地把 GitHub 上的那个临时验证仓库彻底删除。

### 3. 生成 User Token

出于安全性考虑，中央仓库禁止在本地构建脚本中使用明文登录密码，必须生成专用的 Token：

1. 点击右上角用户头像进入 **Account** 页面；
2. 在 **User Token** 区域点击 **Generate User Token**；
3. 系统会生成一对 **Username** 与 **Password**（形式类似一串长哈希字符），务必立即复制保存，关闭窗口后将无法再次查看密码。

## 三、第二步：生成 GPG 秘钥并分发至公钥服务器

Maven Central 强制规定：**所有发布的构建产物（包括 `.jar`、`.pom`、`-sources.jar`、`-javadoc.jar`）都必须附带 GPG 数字签名（`.asc` 文件）**，以防传输途中文件被篡改或仿冒。

### 1. 本地安装 GPG

```bash
# macOS (Homebrew)
brew install gnupg pinentry-mac

# Ubuntu / Debian
sudo apt-get install gnupg

# Windows (推荐安装 Gpg4win)
```

### 2. 生成密钥对

运行生成命令：

```bash
gpg --full-generate-key
```

根据提示进行选择：

- 加密算法：默认选择 `(1) RSA and RSA`；
- 密钥长度：输入 `4096`（推荐 4096 位高安全性）；
- 有效期：建议选择永久有效（输入 `0`）或者按年设定；
- 姓名、邮箱：建议与 GitHub 账号邮箱保持一致；
- 设置 Passphrase（密码）：**请牢记此密码**，后续 Maven 执行打包签名时需要输入。

### 3. 查看公钥 ID 并分发

执行以下命令列出本地的公钥信息：

```bash
gpg --list-keys --keyid-format LONG
```

输出示例：

```text
sec   rsa4096/A1B2C3D4E5F67890 2026-10-18 [SC]
      E28F10234567890ABCDEF1234567890ABCDEF123
uid                 [ultimate] upowerman <your_email@example.com>
ssb   rsa4096/0987654F3E2D1CBA 2026-10-18 [E]
```

其中 `rsa4096/` 后面的 16 位字符（如 `A1B2C3D4E5F67890`）就是你的 **Key ID**。

中央仓库在校验签名时，会自动到主流公钥服务器检索该 ID 的公钥。因此必须将公钥分发出去：

```bash
# 上传到 Ubuntu 官方密钥服务器（推荐，同步范围最广）
gpg --keyserver keyserver.ubuntu.com --send-keys A1B2C3D4E5F67890

# 若网络不稳定，可备选上传至 keys.openpgp.org
gpg --keyserver hkps://keys.openpgp.org --send-keys A1B2C3D4E5F67890
```

## 四、第三步：配置 Maven 本地认证 (settings.xml)

打开本地 Maven 的用户配置文件 `~/.m2/settings.xml`（若不存在可新建一个），在 `` 节点内配置我们在第一步生成的 User Token：

```xml
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
    <servers>
        <server>
            <id>central</id>
            <username>你的_CENTRAL_USER_TOKEN_NAME</username>
            <password>你的_CENTRAL_USER_TOKEN_PASSWORD</password>
        </server>
    </servers>
</settings>
```

**注意**：这里的 `central` 必须与项目中 POM 插件的 `` 完全一致。

## 五、第四步：项目 POM 开源合规与插件配置（small-rpc 实战）

接下来是核心实操。我们以 **small-rpc** 的真实根 `pom.xml` 为蓝本，逐一剖析必须具备的合规配置与插件链。

### 1. 必填开源元数据

Central 严禁匿名或缺失版权信息的依赖发布。顶级 `pom.xml` 中必须包含项目描述、开源协议、开发者信息以及 SCM 源码仓库地址：

```xml
<groupId>io.github.upowerman</groupId>
<artifactId>small-rpc</artifactId>
<version>2.1.1</version>
<packaging>pom</packaging>

<name>Small RPC</name>
<description>A lightweight, extensible, high-performance Java RPC framework.</description>
<url>https://github.com/upowerman/small-rpc</url>

<licenses>
    <license>
        <name>Apache License, Version 2.0</name>
        <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>
        <distribution>repo</distribution>
    </license>
</licenses>

<developers>
    <developer>
        <id>upowerman</id>
        <name>upowerman</name>
        <url>https://github.com/upowerman</url>
    </developer>
</developers>

<scm>
    <connection>scm:git:https://github.com/upowerman/small-rpc.git</connection>
    <developerConnection>scm:git:git@github.com:upowerman/small-rpc.git</developerConnection>
    <url>https://github.com/upowerman/small-rpc</url>
</scm>
```

### 2. 打包 Profile 与发布插件组

为了避免日常本地构建（如 `mvn test` 或 `mvn compile`）每次都重复执行漫长的 Javadoc 生成与签名，我们将发布插件统一封装在 `` 中，仅在发包时激活：

```xml
<profiles>
    <profile>
        <id>release</id>
        <build>
            <plugins>
                <!-- 1. 官方 Central 发布插件（替代旧的 nexus-staging） -->
                <plugin>
                    <groupId>org.sonatype.central</groupId>
                    <artifactId>central-publishing-maven-plugin</artifactId>
                    <version>0.11.0</version>
                    <extensions>true</extensions>
                    <configuration>
                        <publishingServerId>central</publishingServerId>
                        <autoPublish>true</autoPublish>
                        <waitUntil>published</waitUntil>
                        <excludeArtifacts>
                            <excludeArtifact>rpc-examples</excludeArtifact>
                            <excludeArtifact>rpc-example-api</excludeArtifact>
                            <excludeArtifact>rpc-example-client</excludeArtifact>
                            <excludeArtifact>rpc-example-server</excludeArtifact>
                        </excludeArtifacts>
                    </configuration>
                </plugin>

                <!-- 2. 源码打包插件（生成 -sources.jar） -->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-source-plugin</artifactId>
                    <version>3.3.0</version>
                    <executions>
                        <execution>
                            <phase>package</phase>
                            <goals>
                                <goal>jar-no-fork</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>

                <!-- 3. Javadoc 打包插件（生成 -javadoc.jar） -->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-javadoc-plugin</artifactId>
                    <version>3.6.3</version>
                    <configuration>
                        <!-- 避坑：关闭严格语法检查，避免因缺少 @param 或 HTML 标签轻微不规范导致打包崩溃 -->
                        <doclint>none</doclint>
                    </configuration>
                    <executions>
                        <execution>
                            <phase>package</phase>
                            <goals>
                                <goal>jar</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>

                <!-- 4. GPG 签名插件（生成 .asc 签名） -->
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-gpg-plugin</artifactId>
                    <version>3.1.0</version>
                    <executions>
                        <execution>
                            <phase>verify</phase>
                            <goals>
                                <goal>sign</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>
            </plugins>
        </build>
    </profile>
</profiles>
```

## 六、关键实战避坑指南（small-rpc 踩坑真实复盘）

在 `small-rpc` 的实际发布过程中，我们遇到了两个非常典型、且在现有搜索引擎中极难找到答案的问题，在此重点记录：

### 避坑点 1：插件版本千万别用 0.7.0！务必升级至 0.11.0+

在 small-rpc 历史提交记录中，有一条明确的修复日志：

> `build(release): central-publishing-maven-plugin 0.7.0 -> 0.11.0（修复 waitUntil=published 轮询解析服务端新增 warnings 字段崩溃）`

**原因复盘**：我们在配置中开启了 `published`，期望 Maven 命令在终端自动阻塞轮询 Central Portal 的发布状态，直到全部模块完成校验与上架。然而，Sonatype 官方在 2024 年下半年对 Central Portal 后端 API 进行了一次升级，在轮询返回的 JSON 中新增了 `warnings` 字段。老版本 `0.7.0` 内部依赖的 Jackson 反序列化策略未忽略未知字段，导致轮询到第二阶段时直接抛出 `UnrecognizedPropertyException` 异常崩溃！升级到 **`0.11.0`** 即可完美支持新版 API。

### 避坑点 2：多模块项目中如何优雅排除 example/demo 模块？

许多开源框架（如 small-rpc、Netty、Dubbo）都会在工程里包含一个或多个 `example` 模块供使用者参考。这些模块绝不能发布到 Maven 中央仓库污染公共命名空间。

如果仅仅在子模块 POM 中配置 `true`，你会发现 `central-publishing-maven-plugin` 在汇总分析构件签名时，依然可能会尝试校验或打包这几个子模块，最终提示签名或 Javadoc 缺失异常。

在 small-rpc 提交 `d850126` 中，我们给出了标准解法——**父子 POM 双保险策略**：

1. **父 POM 显式排除**：在 `central-publishing-maven-plugin` 配置中使用 ``：

```xml
<excludeArtifacts>
    <excludeArtifact>rpc-examples</excludeArtifact>
    <excludeArtifact>rpc-example-api</excludeArtifact>
    <excludeArtifact>rpc-example-client</excludeArtifact>
    <excludeArtifact>rpc-example-server</excludeArtifact>
</excludeArtifacts>
```

2. **子模块 POM 跳过全套发布生命周期**：在 `rpc-examples/pom.xml` 的 `` 中增加如下属性：

```xml
<properties>
    <maven.deploy.skip>true</maven.deploy.skip>
    <gpg.skip>true</gpg.skip>
    <maven.javadoc.skip>true</maven.javadoc.skip>
    <maven.source.skip>true</maven.source.skip>
</properties>
```

这样既保证了父工程 `mvn clean test` 时 demo 参与自动化测试，又杜绝了发包时 demo 构件泄露或产生校验干扰。

## 七、第五步：一键打包发布与验证

全部配置就绪后，发布变得极其简单。只需要在项目根目录下执行一行命令：

```bash
mvn clean deploy -Prelease
```

此时 Maven 会全自动执行以下流程：

1. **编译与打包**：编译 Java 源码并生成标准的 `.jar`；
2. **源码与 Javadoc**：自动生成对应的 `-sources.jar` 与 `-javadoc.jar`；
3. **GPG 签名**：调用本地 GPG 工具对所有产物生成 `.asc` 签名文件（若未在守护进程缓存密码，终端会弹出密码输入提示）；
4. **打包 Bundle 并上传**：`central-publishing-maven-plugin` 将所有模块产物打包成 Zip，自动调用 Central Portal API 进行分块上传；
5. **自动校验与发布**：因为配置了 `true`，Portal 校验（Namespace 正确性、PGP 签名合法性、Checksum 比对、POM 完整性）全绿通过后，将自动变更为 `PUBLISHED` 状态。

### 如何验证包已上线？

- **Central Portal 控制台**：访问 [Publishing Deployments](https://central.sonatype.com/publishing/deployments) 查看部署状态与执行详情；
- **中央仓库索引同步**：发布成功后约 **15~30 分钟**，全球 Maven 镜像源即会完成同步，任何项目即可通过坐标直接引入：

```xml
<dependency>
    <groupId>io.github.upowerman</groupId>
    <artifactId>small-rpc-spring-boot-starter</artifactId>
    <version>2.1.1</version>
</dependency>
```

- **mvnrepository 检索**：通常在 **2~4 小时** 内，[mvnrepository.com](https://mvnrepository.com/) 的爬虫就会抓取到最新版本并呈现完整的依赖树信息。

## 八、写在最后

将自己的开源框架发布到 Maven 中央仓库，不仅是对自身代码工程化规范的一次全面洗礼（严格的开源协议、SCM、完整 Javadoc 和源码包保证），也是让技术成果能够真正服务于社区开发者的关键一步。

如果你正在构建自己的 Java 工具或开源框架，欢迎参考 [small-rpc](https://github.com/upowerman/small-rpc) 的完整工程结构与 `pom.xml` 配置，也欢迎来仓库提 issue 或进行交流探讨！
