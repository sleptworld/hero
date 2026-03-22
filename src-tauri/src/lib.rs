use std::fs;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::Manager;
use serde::Serialize;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use git2::{BranchType, Cred, IndexAddOption, PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions};

#[tauri::command]
fn clone_hexo_repo_to_documents(app: tauri::AppHandle, remote_url: String) -> Result<String, String> {
  let trimmed = remote_url.trim();
  if trimmed.is_empty() {
    return Err("Remote repository URL is required".into());
  }

  let repo_name = infer_repo_name(trimmed)?;
  let documents_dir = app
    .path()
    .document_dir()
    .map_err(|e| format!("Failed to resolve Documents directory: {e}"))?;

  let base_dir = documents_dir.join("Hero");
  fs::create_dir_all(&base_dir)
    .map_err(|e| format!("Failed to create destination directory: {e}"))?;

  let target_dir = base_dir.join(repo_name);
  if target_dir.exists() {
    return Ok(path_to_string(&target_dir));
  }

  Repository::clone(trimmed, &target_dir)
    .map_err(|e| format!("Failed to clone repository: {e}"))?;

  Ok(path_to_string(&target_dir))
}

#[derive(Serialize)]
struct HexoRepoOverview {
  hexo_version: Option<String>,
  post_count: usize,
  draft_count: usize,
  tag_count: usize,
  repo_path: String,
}

#[derive(Serialize)]
struct HexoPostItem {
  title: String,
  description: String,
  relative_path: String,
  kind: String,
}

#[derive(Serialize)]
struct SaveHexoPostResult {
  relative_path: String,
  title: String,
  front_matter: String,
}

#[derive(Serialize)]
struct HexoSyncStatus {
  has_remote: bool,
  has_changes: bool,
  has_unpushed_commits: bool,
  branch: Option<String>,
}

#[derive(Serialize)]
struct HexoSyncResult {
  committed: bool,
  pushed: bool,
}

#[tauri::command]
fn get_hexo_repo_overview(repo_path: String) -> Result<HexoRepoOverview, String> {
  let repo = PathBuf::from(repo_path.trim());
  if !repo.exists() {
    return Err("Repository path does not exist".into());
  }
  if !repo.is_dir() {
    return Err("Repository path is not a directory".into());
  }

  let hexo_version = read_hexo_version(&repo);
  let (post_count, draft_count, tag_count) = collect_hexo_stats(&repo)?;

  Ok(HexoRepoOverview {
    hexo_version,
    post_count,
    draft_count,
    tag_count,
    repo_path: path_to_string(&repo),
  })
}

#[tauri::command]
fn list_hexo_posts(repo_path: String) -> Result<Vec<HexoPostItem>, String> {
  let repo = PathBuf::from(repo_path.trim());
  if !repo.exists() || !repo.is_dir() {
    return Err("Repository path is invalid".into());
  }

  let posts_dir = repo.join("source").join("_posts");
  let drafts_dir = repo.join("source").join("_drafts");
  if !posts_dir.exists() && !drafts_dir.exists() {
    return Ok(Vec::new());
  }

  let mut items_with_sort_time: Vec<(i64, HexoPostItem)> = Vec::new();
  let mut stack: Vec<(PathBuf, bool)> = Vec::new();
  if posts_dir.exists() {
    stack.push((posts_dir, false));
  }
  if drafts_dir.exists() {
    stack.push((drafts_dir, true));
  }
  while let Some((dir, is_draft_dir)) = stack.pop() {
    for entry in fs::read_dir(&dir)
      .map_err(|e| format!("Failed reading directory {}: {e}", dir.display()))?
    {
      let entry = entry.map_err(|e| format!("Failed reading dir entry: {e}"))?;
      let path = entry.path();
      if path.is_dir() {
        stack.push((path, is_draft_dir));
        continue;
      }

      let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
      if ext != "md" && ext != "markdown" {
        continue;
      }

      if let Ok(content) = fs::read_to_string(&path) {
        let title = extract_front_matter_field(&content, "title")
          .or_else(|| {
            path.file_stem()
              .and_then(|v| v.to_str())
              .map(|v| v.to_string())
          })
          .unwrap_or_else(|| "Untitled".to_string());
        let description = extract_front_matter_field(&content, "description")
          .or_else(|| extract_first_non_empty_body_line(&content))
          .unwrap_or_default();
        let kind = if is_draft_dir {
          "draft".to_string()
        } else if is_unpublished_post(&content) {
          "unpublished".to_string()
        } else {
          "post".to_string()
        };
        let relative_path = path
          .strip_prefix(&repo)
          .ok()
          .and_then(|p| p.to_str())
          .map(|v| v.to_string())
          .unwrap_or_else(|| path_to_string(&path));
        let modified_unix = fs::metadata(&path)
          .ok()
          .and_then(|m| m.modified().ok())
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map(|d| d.as_secs() as i64)
          .unwrap_or(0);
        let publish_time = extract_front_matter_field(&content, "date")
          .and_then(|d| parse_hexo_date_to_unix(&d))
          .unwrap_or(modified_unix);

        items_with_sort_time.push((publish_time, HexoPostItem {
          title,
          description,
          relative_path,
          kind,
        }));
      }
    }
  }

  items_with_sort_time.sort_by(|a, b| {
    b.0.cmp(&a.0).then_with(|| a.1.title.to_lowercase().cmp(&b.1.title.to_lowercase()))
  });
  let items = items_with_sort_time.into_iter().map(|(_, item)| item).collect();
  Ok(items)
}

#[tauri::command]
fn save_hexo_post(
  repo_path: String,
  relative_path: Option<String>,
  title: String,
  markdown: String,
  front_matter: Option<String>,
  target: String,
  tags: Option<Vec<String>>,
  categories: Option<Vec<String>>,
) -> Result<SaveHexoPostResult, String> {
  let repo = PathBuf::from(repo_path.trim());
  if !repo.exists() || !repo.is_dir() {
    return Err("Repository path is invalid".into());
  }

  let target_kind = normalize_save_target(&target)?;
  let target_dir = repo.join("source").join(target_kind.dir_name());
  fs::create_dir_all(&target_dir)
    .map_err(|e| format!("Failed to create target directory: {e}"))?;

  let normalized_title = normalize_title(&title);
  let resolved_relative = match relative_path {
    Some(path) if !path.trim().is_empty() => {
      let normalized = path.replace('\\', "/");
      ensure_safe_relative_post_path(&normalized)?;
      if normalized.starts_with(target_kind.relative_prefix()) {
        normalized
      } else {
        let slug = slugify_title(&normalized_title);
        create_available_post_relative_path(&repo, &slug, target_kind)
      }
    }
    _ => {
      let slug = slugify_title(&normalized_title);
      create_available_post_relative_path(&repo, &slug, target_kind)
    }
  };

  let target_path = repo.join(&resolved_relative);
  if let Some(parent) = target_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|e| format!("Failed to create post parent directory: {e}"))?;
  }

  let merged_front_matter = upsert_title(
    front_matter.as_deref(),
    &normalized_title,
    tags.as_deref(),
    categories.as_deref(),
  );
  let body = markdown.trim_end();
  let document = format!("---\n{}\n---\n\n{}\n", merged_front_matter.trim_end(), body);
  fs::write(&target_path, document)
    .map_err(|e| format!("Failed to write post file: {e}"))?;

  Ok(SaveHexoPostResult {
    relative_path: resolved_relative,
    title: normalized_title,
    front_matter: merged_front_matter,
  })
}

#[tauri::command]
fn delete_hexo_post(repo_path: String, relative_path: String) -> Result<(), String> {
  let repo = PathBuf::from(repo_path.trim());
  if !repo.exists() || !repo.is_dir() {
    return Err("Repository path is invalid".into());
  }

  let normalized = relative_path.trim().replace('\\', "/");
  ensure_safe_relative_post_path(&normalized)?;
  let target = repo.join(&normalized);
  if !target.exists() {
    return Err("Post file does not exist".into());
  }
  if !target.is_file() {
    return Err("Target path is not a file".into());
  }

  fs::remove_file(&target)
    .map_err(|e| format!("Failed to delete post file: {e}"))?;
  Ok(())
}

#[tauri::command]
async fn get_hexo_sync_status(repo_path: String) -> Result<HexoSyncStatus, String> {
  tauri::async_runtime::spawn_blocking(move || get_hexo_sync_status_blocking(repo_path))
    .await
    .map_err(|e| format!("Failed to resolve sync status task: {e}"))?
}

fn get_hexo_sync_status_blocking(repo_path: String) -> Result<HexoSyncStatus, String> {
  let repo = PathBuf::from(repo_path.trim());
  let git_repo = open_git_repo(&repo)?;
  let has_remote = git_repo
    .remotes()
    .map_err(|e| format!("Failed to read git remotes: {e}"))?
    .iter()
    .flatten()
    .next()
    .is_some();
  let has_changes = repo_has_changes(&git_repo)?;
  let branch = current_branch_name(&git_repo);
  let has_unpushed_commits = has_unpushed_commits(&git_repo, branch.as_deref(), has_remote)?;

  Ok(HexoSyncStatus {
    has_remote,
    has_changes,
    has_unpushed_commits,
    branch,
  })
}

#[tauri::command]
async fn sync_hexo_repo(repo_path: String) -> Result<HexoSyncResult, String> {
  tauri::async_runtime::spawn_blocking(move || sync_hexo_repo_blocking(repo_path))
    .await
    .map_err(|e| format!("Failed to run sync task: {e}"))?
}

fn sync_hexo_repo_blocking(repo_path: String) -> Result<HexoSyncResult, String> {
  let repo = PathBuf::from(repo_path.trim());
  let git_repo = open_git_repo(&repo)?;
  let remote_name = first_remote_name(&git_repo)?
    .ok_or_else(|| "No git remote found for this repository".to_string())?;
  let branch = current_branch_name(&git_repo)
    .ok_or_else(|| "Cannot push from detached HEAD".to_string())?;

  let has_changes = repo_has_changes(&git_repo)?;
  let has_unpushed = has_unpushed_commits(&git_repo, Some(&branch), true)?;
  if !has_changes && !has_unpushed {
    return Err("No local changes or unpushed commits to sync".into());
  }

  let mut committed = false;
  if has_changes {
    let mut index = git_repo
      .index()
      .map_err(|e| format!("Failed to access git index: {e}"))?;
    index
      .add_all(["*"], IndexAddOption::DEFAULT, None)
      .map_err(|e| format!("Failed to stage changes: {e}"))?;
    index
      .write()
      .map_err(|e| format!("Failed to write index: {e}"))?;
    let tree_id = index
      .write_tree()
      .map_err(|e| format!("Failed to write tree: {e}"))?;
    let tree = git_repo
      .find_tree(tree_id)
      .map_err(|e| format!("Failed to load tree: {e}"))?;

    let signature = git_repo
      .signature()
      .or_else(|_| Signature::now("Hero Sync", "hero@localhost"))
      .map_err(|e| format!("Failed to resolve git author signature: {e}"))?;
    let message = format!("chore(hero): sync updates {}", Local::now().format("%Y-%m-%d %H:%M:%S"));
    let maybe_head_commit = git_repo
      .head()
      .ok()
      .and_then(|head| head.target())
      .and_then(|oid| git_repo.find_commit(oid).ok());
    if let Some(parent) = maybe_head_commit.as_ref() {
      git_repo
        .commit(Some("HEAD"), &signature, &signature, &message, &tree, &[parent])
        .map_err(|e| format!("Failed to create commit: {e}"))?;
    } else {
      git_repo
        .commit(Some("HEAD"), &signature, &signature, &message, &tree, &[])
        .map_err(|e| format!("Failed to create initial commit: {e}"))?;
    }
    committed = true;
  }

  push_current_branch(&git_repo, &remote_name, &branch)?;
  if let Ok(mut local_branch) = git_repo.find_branch(&branch, BranchType::Local) {
    let upstream = format!("{remote_name}/{branch}");
    let _ = local_branch.set_upstream(Some(&upstream));
  }

  Ok(HexoSyncResult {
    committed,
    pushed: true,
  })
}

fn has_unpushed_commits(repo: &Repository, branch: Option<&str>, has_remote: bool) -> Result<bool, String> {
  if !has_remote {
    return Ok(false);
  }

  let Some(branch_name) = branch else {
    return Ok(false);
  };

  let Ok(local_branch) = repo.find_branch(branch_name, BranchType::Local) else {
    return Ok(false);
  };

  let Ok(upstream_branch) = local_branch.upstream() else {
    // Branch without upstream but with remote: treat as pushable.
    return Ok(true);
  };

  let Some(local_oid) = local_branch.get().target() else {
    return Ok(false);
  };
  let Some(upstream_oid) = upstream_branch.get().target() else {
    return Ok(true);
  };
  let (ahead, _) = repo
    .graph_ahead_behind(local_oid, upstream_oid)
    .map_err(|e| format!("Failed to compare local branch with upstream: {e}"))?;
  Ok(ahead > 0)
}

fn ensure_valid_repo_dir(repo: &PathBuf) -> Result<(), String> {
  if !repo.exists() || !repo.is_dir() {
    return Err("Repository path is invalid".into());
  }
  Ok(())
}

fn open_git_repo(repo: &PathBuf) -> Result<Repository, String> {
  ensure_valid_repo_dir(repo)?;
  Repository::open(repo).map_err(|e| format!("Failed to open git repository: {e}"))
}

fn repo_has_changes(repo: &Repository) -> Result<bool, String> {
  let mut options = StatusOptions::new();
  options
    .include_untracked(true)
    .recurse_untracked_dirs(true)
    .renames_head_to_index(true);
  let statuses = repo
    .statuses(Some(&mut options))
    .map_err(|e| format!("Failed to inspect git status: {e}"))?;
  Ok(!statuses.is_empty())
}

fn current_branch_name(repo: &Repository) -> Option<String> {
  let head = repo.head().ok()?;
  if !head.is_branch() {
    return None;
  }
  head.shorthand().map(|name| name.to_string())
}

fn first_remote_name(repo: &Repository) -> Result<Option<String>, String> {
  let remotes = repo
    .remotes()
    .map_err(|e| format!("Failed to read git remotes: {e}"))?;
  Ok(remotes.iter().flatten().next().map(|name| name.to_string()))
}

fn push_current_branch(repo: &Repository, remote_name: &str, branch: &str) -> Result<(), String> {
  let mut callbacks = RemoteCallbacks::new();
  callbacks.credentials(|_url, username_from_url, _allowed_types| {
    if let Some(user) = username_from_url {
      Cred::ssh_key_from_agent(user).or_else(|_| Cred::default())
    } else {
      Cred::default()
    }
  });

  let mut push_options = PushOptions::new();
  push_options.remote_callbacks(callbacks);

  let mut remote = repo
    .find_remote(remote_name)
    .map_err(|e| format!("Failed to find remote '{remote_name}': {e}"))?;
  let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
  remote
    .push(&[refspec.as_str()], Some(&mut push_options))
    .map_err(|e| format!("Failed to push to remote '{remote_name}': {e}"))?;
  Ok(())
}

fn infer_repo_name(remote_url: &str) -> Result<String, String> {
  let normalized = remote_url.trim_end_matches('/').trim_end_matches(".git");
  let candidate = normalized
    .rsplit('/')
    .next()
    .and_then(|v| v.rsplit(':').next())
    .unwrap_or_default()
    .trim();

  if candidate.is_empty() {
    return Err("Unable to infer repository name from remote URL".into());
  }

  Ok(candidate.to_string())
}

fn normalize_title(raw: &str) -> String {
  let t = raw.trim();
  if t.is_empty() {
    "Untitled".to_string()
  } else {
    t.to_string()
  }
}

fn slugify_title(title: &str) -> String {
  let lower = title.to_lowercase();
  let mut slug = String::new();
  let mut prev_dash = false;
  for ch in lower.chars() {
    if ch.is_ascii_alphanumeric() {
      slug.push(ch);
      prev_dash = false;
    } else if !prev_dash {
      slug.push('-');
      prev_dash = true;
    }
  }
  while slug.ends_with('-') {
    slug.pop();
  }
  while slug.starts_with('-') {
    slug.remove(0);
  }
  if slug.is_empty() {
    format!("post-{}", chrono_like_timestamp())
  } else {
    slug
  }
}

fn chrono_like_timestamp() -> u64 {
  use std::time::{SystemTime, UNIX_EPOCH};
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn create_available_post_relative_path(repo: &PathBuf, slug: &str, target: SaveTarget) -> String {
  let mut index = 0u32;
  loop {
    let file_name = if index == 0 {
      format!("{slug}.md")
    } else {
      format!("{slug}-{index}.md")
    };
    let relative = format!("source/{}/{file_name}", target.dir_name());
    if !repo.join(&relative).exists() {
      return relative;
    }
    index += 1;
  }
}

fn ensure_safe_relative_post_path(path: &str) -> Result<(), String> {
  if path.starts_with('/') || path.starts_with('\\') {
    return Err("Path must be relative".into());
  }
  if path.contains("..") {
    return Err("Path must not contain parent traversal".into());
  }
  if !path.starts_with("source/_posts/") && !path.starts_with("source/_drafts/") {
    return Err("Path must be under source/_posts or source/_drafts".into());
  }
  Ok(())
}

fn format_yaml_inline_list(values: Option<&[String]>) -> String {
  let mut normalized: Vec<String> = Vec::new();
  if let Some(items) = values {
    for item in items {
      let t = item.trim();
      if !t.is_empty() {
        normalized.push(t.to_string());
      }
    }
  }
  if normalized.is_empty() {
    "[]".to_string()
  } else {
    format!("[{}]", normalized.join(", "))
  }
}

fn upsert_title(
  front_matter: Option<&str>,
  title: &str,
  tags: Option<&[String]>,
  categories: Option<&[String]>,
) -> String {
  let normalized = normalize_title(title);
  let date_line = format!("date: {}", Local::now().format("%Y-%m-%d %H:%M:%S"));
  let tags_line = format!("tags: {}", format_yaml_inline_list(tags));
  let categories_line = format!("categories: {}", format_yaml_inline_list(categories));

  match front_matter {
    Some(raw) => {
      let mut lines: Vec<String> = raw.lines().map(|l| l.to_string()).collect();
      let mut replaced = false;
      for line in &mut lines {
        if line.trim_start().starts_with("title:") {
          *line = format!("title: {normalized}");
          replaced = true;
          break;
        }
      }
      if !replaced {
        lines.insert(0, format!("title: {normalized}"));
      }
      if !lines.iter().any(|l| l.trim_start().starts_with("date:")) {
        lines.push(date_line);
      }
      let mut replaced_tags = false;
      let mut replaced_categories = false;
      for line in &mut lines {
        if line.trim_start().starts_with("tags:") {
          *line = tags_line.clone();
          replaced_tags = true;
        }
        if line.trim_start().starts_with("categories:") {
          *line = categories_line.clone();
          replaced_categories = true;
        }
      }
      if !replaced_tags {
        lines.push(tags_line);
      }
      if !replaced_categories {
        lines.push(categories_line);
      }
      lines.join("\n")
    }
    None => format!("title: {normalized}\n{date_line}\n{tags_line}\n{categories_line}"),
  }
}

#[derive(Copy, Clone)]
enum SaveTarget {
  Publish,
  Draft,
}

impl SaveTarget {
  fn dir_name(self) -> &'static str {
    match self {
      SaveTarget::Publish => "_posts",
      SaveTarget::Draft => "_drafts",
    }
  }

  fn relative_prefix(self) -> &'static str {
    match self {
      SaveTarget::Publish => "source/_posts/",
      SaveTarget::Draft => "source/_drafts/",
    }
  }
}

fn normalize_save_target(target: &str) -> Result<SaveTarget, String> {
  match target.trim().to_ascii_lowercase().as_str() {
    "publish" => Ok(SaveTarget::Publish),
    "draft" => Ok(SaveTarget::Draft),
    _ => Err("Invalid save target; expected publish or draft".into()),
  }
}

fn path_to_string(path: &PathBuf) -> String {
  path.to_string_lossy().to_string()
}

fn read_hexo_version(repo: &PathBuf) -> Option<String> {
  let package_json = repo.join("package.json");
  let content = fs::read_to_string(package_json).ok()?;
  let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
  parsed
    .get("dependencies")
    .and_then(|d| d.get("hexo"))
    .or_else(|| parsed.get("devDependencies").and_then(|d| d.get("hexo")))
    .and_then(|v| v.as_str())
    .map(|v| v.to_string())
}

fn collect_hexo_stats(repo: &PathBuf) -> Result<(usize, usize, usize), String> {
  let posts_dir = repo.join("source").join("_posts");
  let drafts_dir = repo.join("source").join("_drafts");

  let mut post_count = 0usize;
  let mut draft_count = 0usize;
  let mut tags: HashSet<String> = HashSet::new();

  let mut stack = Vec::new();
  if posts_dir.exists() {
    stack.push((posts_dir, true));
  }
  if drafts_dir.exists() {
    stack.push((drafts_dir, false));
  }

  while let Some((dir, is_post_dir)) = stack.pop() {
    for entry in fs::read_dir(&dir)
      .map_err(|e| format!("Failed reading directory {}: {e}", dir.display()))?
    {
      let entry = entry.map_err(|e| format!("Failed reading dir entry: {e}"))?;
      let path = entry.path();
      if path.is_dir() {
        stack.push((path, is_post_dir));
        continue;
      }
      let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
      if ext != "md" && ext != "markdown" {
        continue;
      }

      if is_post_dir {
        post_count += 1;
      } else {
        draft_count += 1;
      }
      if let Ok(content) = fs::read_to_string(&path) {
        for tag in extract_tags_from_front_matter(&content) {
          tags.insert(tag);
        }
      }
    }
  }

  Ok((post_count, draft_count, tags.len()))
}

fn extract_tags_from_front_matter(content: &str) -> Vec<String> {
  let mut tags = Vec::new();
  if !content.starts_with("---") {
    return tags;
  }

  let mut lines = content.lines();
  lines.next();

  let mut in_tags_block = false;
  for line in lines {
    let trimmed = line.trim();
    if trimmed == "---" {
      break;
    }

    if in_tags_block {
      if let Some(tag) = trimmed.strip_prefix("-") {
        let value = tag.trim();
        if !value.is_empty() {
          tags.push(value.to_string());
        }
        continue;
      }
      if trimmed.is_empty() {
        continue;
      }
      in_tags_block = false;
    }

    if let Some(rest) = trimmed.strip_prefix("tags:") {
      let value = rest.trim();
      if value.starts_with('[') && value.ends_with(']') {
        let list = &value[1..value.len() - 1];
        for item in list.split(',') {
          let tag = item.trim().trim_matches('"').trim_matches('\'');
          if !tag.is_empty() {
            tags.push(tag.to_string());
          }
        }
      } else if value.is_empty() {
        in_tags_block = true;
      } else {
        let tag = value.trim_matches('"').trim_matches('\'');
        if !tag.is_empty() {
          tags.push(tag.to_string());
        }
      }
    }
  }

  tags
}

fn extract_front_matter_field(content: &str, key: &str) -> Option<String> {
  if !content.starts_with("---") {
    return None;
  }

  let key_prefix = format!("{key}:");
  let mut lines = content.lines();
  lines.next();

  for line in lines {
    let trimmed = line.trim();
    if trimmed == "---" {
      break;
    }
    if let Some(raw_value) = trimmed.strip_prefix(&key_prefix) {
      let value = raw_value.trim().trim_matches('"').trim_matches('\'').to_string();
      if !value.is_empty() {
        return Some(value);
      }
    }
  }

  None
}

fn extract_first_non_empty_body_line(content: &str) -> Option<String> {
  let mut lines = content.lines();
  if content.starts_with("---") {
    lines.next();
    for line in lines.by_ref() {
      if line.trim() == "---" {
        break;
      }
    }
  }

  for line in lines {
    let text = line.trim();
    if !text.is_empty() {
      return Some(text.to_string());
    }
  }
  None
}

fn parse_hexo_date_to_unix(value: &str) -> Option<i64> {
  let raw = value.trim().trim_matches('"').trim_matches('\'');
  if raw.is_empty() {
    return None;
  }

  if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
    return Some(dt.timestamp());
  }

  if let Ok(naive) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
    return Local.from_local_datetime(&naive).single().map(|d| d.timestamp());
  }

  if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
    let naive = date.and_hms_opt(0, 0, 0)?;
    return Local.from_local_datetime(&naive).single().map(|d| d.timestamp());
  }

  None
}

fn is_unpublished_post(content: &str) -> bool {
  let value = extract_front_matter_field(content, "published");
  match value {
    Some(v) => {
      let normalized = v.trim().to_ascii_lowercase();
      normalized == "false" || normalized == "0" || normalized == "no"
    }
    None => false,
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      clone_hexo_repo_to_documents,
      get_hexo_repo_overview,
      list_hexo_posts,
      save_hexo_post,
      delete_hexo_post,
      get_hexo_sync_status,
      sync_hexo_repo
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
