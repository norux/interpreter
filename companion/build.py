"""Build a relocatable Apple Silicon app and drag-to-Applications disk image."""

import argparse
import base64
import hashlib
import json
import os
import platform
import plistlib
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def run(arguments):
    subprocess.run(
        [str(argument) for argument in arguments],
        cwd=REPO,
        check=True,
        env={**os.environ, "MACOSX_DEPLOYMENT_TARGET": "14.0"},
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ollama-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=REPO / "dist/companion")
    options = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("Build on an Apple Silicon Mac.")
    uv = shutil.which("uv") or str(REPO / ".tools/uv/bin/uv")
    output = options.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    app = output / "Interpreter Companion.app"
    if app.exists():
        shutil.rmtree(app)
    resources = app / "Contents/Resources"
    binaries = app / "Contents/MacOS"
    resources.mkdir(parents=True)
    binaries.mkdir()
    prefix = (
        Path(
            subprocess.check_output(
                [uv, "python", "find", "3.12", "--managed-python"], cwd=REPO, text=True
            ).strip()
        )
        .resolve()
        .parent.parent
    )
    shutil.copytree(prefix, resources / "python", symlinks=True)
    packages = resources / "python/lib/python3.12/site-packages"
    requirements = output / "requirements.txt"
    run(
        [
            uv,
            "export",
            "--locked",
            "--extra",
            "local",
            "--no-dev",
            "--no-emit-project",
            "--output-file",
            requirements,
        ]
    )
    run(
        [
            uv,
            "pip",
            "install",
            "--python",
            resources / "python/bin/python3.12",
            "--target",
            packages,
            "--python-platform",
            "aarch64-apple-darwin",
            "--require-hashes",
            "-r",
            requirements,
        ]
    )
    shutil.copytree(
        REPO / "server",
        resources / "server",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    shutil.copy2(REPO / "companion/runtime.py", resources / "runtime.py")
    shutil.copytree(REPO / "extension/dist", resources / "extension")
    shutil.copytree(options.ollama_dir, resources / "ollama", symlinks=True)
    manifest = json.loads((REPO / "extension/public/manifest.json").read_text())
    digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
    extension_id = "".join(chr(ord("a") + int(character, 16)) for character in digest)
    (resources / "companion.json").write_text(json.dumps({"extensionId": extension_id}))
    info = {
        "CFBundleExecutable": "Interpreter Companion",
        "CFBundleIdentifier": "com.norux.interpreter.companion",
        "CFBundleName": "Interpreter Companion",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": manifest["version"],
        "CFBundleVersion": manifest["version"],
        "LSMinimumSystemVersion": "14.0",
        "NSHighResolutionCapable": True,
    }
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    run(
        [
            "swiftc",
            "-swift-version",
            "5",
            "-O",
            "-target",
            "arm64-apple-macos14.0",
            "-framework",
            "AppKit",
            REPO / "companion/Launcher.swift",
            "-o",
            binaries / "Interpreter Companion",
        ]
    )
    # A local ad-hoc signature is not Developer ID signing or Apple notarization.
    run(["codesign", "--force", "--sign", "-", app])
    staging = output / "image"
    staging.mkdir(exist_ok=True)
    link = staging / app.name
    if link.exists():
        shutil.rmtree(link)
    shutil.copytree(app, link, symlinks=True)
    applications = staging / "Applications"
    if not applications.is_symlink():
        applications.symlink_to("/Applications")
    (staging / "설치 안내.txt").write_text(
        "Interpreter Companion.app을 Applications로 옮긴 뒤 한 번 여세요.\n"
        "앱에서 모델 준비 시작을 누르고 완료될 때까지 기다리세요.\n"
        "확장 폴더 열기를 누르고 Chrome 개발자 모드에서 해당 폴더를 로드하세요.\n"
        "이후 Chrome 확장의 Start로 로컬 번역이 자동 실행됩니다.\n"
        "개발 빌드: Apple Developer ID 서명·공증은 적용되지 않았습니다.\n"
    )
    image = output / "Interpreter-Companion-macos-arm64.dmg"
    run(
        [
            "hdiutil",
            "create",
            "-ov",
            "-volname",
            "Interpreter Companion",
            "-srcfolder",
            staging,
            "-format",
            "UDZO",
            image,
        ]
    )
    # This is an integrity checksum, not a substitute for a release signature.
    checksum = hashlib.sha256(image.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(f"{checksum}  {image.name}\n")
    shutil.rmtree(staging)
    print(f"Built {image}\nExtension ID: {extension_id}")


if __name__ == "__main__":
    main()
