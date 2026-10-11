use rand::RngExt;
use rand_distr::Alphanumeric;
use vergen_gitcl::{Build, Emitter, Gitcl};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let gitcl = Gitcl::builder()
        .sha(true) // outputs 'VERGEN_GIT_SHA', and sets the 'short' flag true
        .commit_date(true) // outputs 'VERGEN_GIT_COMMIT_DATE'
        .build();

    let build = Build::builder()
        .build_date(true) // outputs 'VERGEN_BUILD_DATE'
        .build();

    let mut emitter = Emitter::default();
    emitter.add_instructions(&build)?;
    let in_git = std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .is_ok_and(|result| result.status.success());
    if in_git {
        emitter.add_instructions(&gitcl)?;
    } else {
        // Source archives have no .git directory. vergen 10 no longer emits
        // these keys when git-cl cannot discover a worktree.
        println!("cargo:rustc-env=VERGEN_GIT_SHA=vendored");
        println!("cargo:rustc-env=VERGEN_GIT_COMMIT_DATE=unknown");
    }
    emitter.emit().expect("Unable to generate the cargo keys!");
    let build_id = match std::env::var("SOURCE_DATE_EPOCH") {
        Ok(val) => val,
        Err(_) => rand::rng()
            .sample_iter(Alphanumeric)
            .take(8)
            .map(char::from)
            .collect(),
    };

    println!("cargo:rustc-env=LIBRESPOT_BUILD_ID={build_id}");
    Ok(())
}
