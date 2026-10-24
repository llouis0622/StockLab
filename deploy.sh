#!/usr/bin/env bash
# Usage: bash /absolute/path/StockLab/deploy.sh [repository-name]
# Creates a PUBLIC repository in the currently authenticated GitHub account.
set -Eeuo pipefail

fail() { printf '\n오류: %s\n' "$*" >&2; exit 1; }
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$project_dir"
repo_name="${1:-StockLab}"
[[ "$repo_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail '저장소 이름은 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 사용할 수 있습니다.'
for executable in git gh node npm; do
  command -v "$executable" >/dev/null 2>&1 || fail "$executable 설치가 필요합니다. macOS에서는 brew install gh node 로 준비할 수 있습니다."
done
[[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 22')" == true ]] || fail 'Node.js 22 이상이 필요합니다.'
[[ -f package.json && -f index.html && -f .github/workflows/pages.yml ]] || fail 'StockLab 전체 소스가 있는 폴더에서 실행해야 합니다.'
[[ -z "${GIT_DIR:-}" && -z "${GIT_WORK_TREE:-}" ]] || fail '현재 터미널의 GIT_DIR/GIT_WORK_TREE 설정을 해제한 뒤 실행해주세요.'

printf '\n[1/6] 빌드와 자동 테스트\n'
npm run build
npm test

printf '\n[2/6] GitHub 로그인 확인\n'
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
fi
identity="$(gh api --hostname github.com user --jq '[.login, (.id | tostring)] | @tsv')"
IFS=$'\t' read -r owner owner_id <<< "$identity"
[[ -n "$owner" && "$owner_id" =~ ^[0-9]+$ ]] || fail 'GitHub 계정 정보를 확인하지 못했습니다.'
repo="$owner/$repo_name"
printf '대상 공개 저장소: https://github.com/%s\n' "$repo"

printf '\n[3/6] StockLab 전용 Git 저장소 준비\n'
# Do not let git walk up to an unrelated repository in Documents or another parent.
if [[ ! -e .git ]]; then git init -b main .; fi
git_root="$(git rev-parse --show-toplevel)"
[[ "$(cd -- "$git_root" && pwd -P)" == "$project_dir" ]] || fail 'StockLab 폴더 자체의 Git 저장소가 아닙니다.'
[[ "$(git branch --show-current)" == main ]] || fail '현재 브랜치가 main이 아닙니다. 사용할 브랜치를 확인해주세요.'
[[ -z "$(git diff --cached --name-only)" ]] || fail '이미 스테이징된 변경이 있습니다. 해당 변경을 먼저 커밋하거나 스테이징을 해제해주세요.'
[[ -z "$(git ls-files --unmerged)" ]] || fail '먼저 Git 병합 충돌을 해결해주세요.'

origin="$(git remote get-url origin 2>/dev/null || true)"
if [[ -n "$origin" ]]; then
  case "$origin" in
    "https://github.com/$repo"|"https://github.com/$repo.git"|"git@github.com:$repo"|"git@github.com:$repo.git"|"ssh://git@github.com/$repo"|"ssh://git@github.com/$repo.git") ;;
    *) fail 'origin이 다른 저장소를 가리킵니다. 기존 연결을 자동으로 변경하지 않았습니다.' ;;
  esac
fi

if repository_state="$(gh api --hostname github.com "repos/$repo" --jq '.private' 2>&1)"; then
  [[ -n "$origin" ]] || fail '같은 이름의 GitHub 저장소가 이미 있습니다. deploy.sh StockLab2 처럼 다른 이름으로 실행해주세요.'
  [[ "$repository_state" == false ]] || fail '기존 저장소가 비공개입니다. 이 스크립트는 공개 여부를 자동 변경하지 않습니다.'
elif [[ "$repository_state" == *'HTTP 404'* ]]; then
  gh repo create "$repo" --public --description '가상 기업 300개로 배우는 Stock Lab 모의투자'
else
  printf '%s\n' "$repository_state" >&2
  fail '저장소 조회에 실패했습니다. 로그인과 네트워크 상태를 확인해주세요.'
fi
if [[ -z "$origin" ]]; then git remote add origin "https://github.com/$repo.git"; fi
if [[ -z "$(git config --get user.name || true)" ]]; then git config --local user.name "$owner"; fi
if [[ -z "$(git config --get user.email || true)" ]]; then git config --local user.email "$owner_id+$owner@users.noreply.github.com"; fi

printf '\n[4/6] 소스 커밋과 업로드\n'
# Explicit paths exclude unrelated files, local backup exports, and parent folders.
git add -- index.html StockLab.html favicon.svg README.md package.json .gitignore .nojekyll .github/workflows/pages.yml src styles scripts tests deploy.sh
if ! git diff --cached --quiet; then git commit -m 'Deploy Stock Lab to GitHub Pages'; fi
commit_sha="$(git rev-parse HEAD)"
git -c credential.helper= -c 'credential.https://github.com.helper=!gh auth git-credential' push --set-upstream origin main
gh repo edit "$repo" --default-branch main

printf '\n[5/6] GitHub Pages 활성화\n'
if pages_state="$(gh api --hostname github.com "repos/$repo/pages" --jq '.build_type' 2>&1)"; then
  if [[ "$pages_state" != workflow ]]; then
    gh api --hostname github.com --method PUT "repos/$repo/pages" -f build_type=workflow --silent
  fi
elif [[ "$pages_state" == *'HTTP 404'* ]]; then
  gh api --hostname github.com --method POST "repos/$repo/pages" -f build_type=workflow --silent
else
  printf '%s\n' "$pages_state" >&2
  fail 'Pages 설정 조회에 실패했습니다. 저장소 관리자 권한을 확인해주세요.'
fi

printf '\n[6/6] 배포 실행과 완료 확인\n'
previous_run="$(gh run list --repo "$repo" --workflow pages.yml --commit "$commit_sha" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
dispatched=false
for attempt in {1..15}; do
  if dispatch_output="$(gh workflow run pages.yml --repo "$repo" --ref main 2>&1)"; then dispatched=true; break; fi
  # A newly pushed workflow can take a moment to become discoverable.
  if [[ "$dispatch_output" != *'HTTP 404'* && "$dispatch_output" != *'Could not find any workflows'* ]]; then
    printf '%s\n' "$dispatch_output" >&2
    fail '배포 시작에 실패했습니다. 기존 토큰의 workflow 권한이 부족하면 gh auth refresh -h github.com -s workflow 후 다시 실행해주세요.'
  fi
  sleep 2
done
[[ "$dispatched" == true ]] || fail "워크플로 등록이 지연됩니다. https://github.com/$repo/actions 에서 확인한 뒤 이 명령어를 다시 실행해주세요."
run_id=''
for attempt in {1..30}; do
  candidate="$(gh run list --repo "$repo" --workflow pages.yml --commit "$commit_sha" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  if [[ -n "$candidate" && "$candidate" != "$previous_run" ]]; then run_id="$candidate"; break; fi
  sleep 2
done
[[ -n "$run_id" ]] || fail "배포 실행 조회가 지연됩니다. https://github.com/$repo/actions 에서 확인해주세요."
if ! gh run watch "$run_id" --repo "$repo" --exit-status --interval 5; then
  printf '\n배포 로그: https://github.com/%s/actions/runs/%s\n' "$repo" "$run_id" >&2
  exit 1
fi
site_url="$(gh api --hostname github.com "repos/$repo/pages" --jq '.html_url')"
[[ "$site_url" == https://* ]] || fail '배포는 끝났지만 Pages 주소를 가져오지 못했습니다.'
printf '\n배포 완료!\n저장소: https://github.com/%s\n사이트: %s\n\n' "$repo" "$site_url"
if command -v open >/dev/null 2>&1; then open "$site_url" || true; fi
