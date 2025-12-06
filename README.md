# Metaschema Framework Maven Artifact Repository

[![Prune Snapshot Artifacts](https://github.com/metaschema-framework/maven2/actions/workflows/prune-snapshots.yml/badge.svg)](https://github.com/metaschema-framework/maven2/actions/workflows/prune-snapshots.yml)

This [independent public repository](https://maven.apache.org/repositories/) contains build artifacts for use with [Apache Maven](https://maven.apache.org/). These artifacts are published here to provide access to developmental `-SNAPSHOT` builds that are not published as standard practice to [Maven Central](https://maven.apache.org/repository/index.html).

## Using This Repository

### Maven Configuration

Add this repository to your `pom.xml` to access SNAPSHOT artifacts:

```xml
<repositories>
  <repository>
    <id>metaschema-snapshots</id>
    <name>Metaschema Framework Snapshots</name>
    <url>https://raw.githubusercontent.com/metaschema-framework/maven2/refs/heads/main</url>
    <snapshots>
      <enabled>true</enabled>
      <updatePolicy>always</updatePolicy>
    </snapshots>
    <releases>
      <enabled>false</enabled>
    </releases>
  </repository>
</repositories>
```

If you need to use SNAPSHOT versions of Maven plugins, also add:

```xml
<pluginRepositories>
  <pluginRepository>
    <id>metaschema-snapshots</id>
    <name>Metaschema Framework Snapshots</name>
    <url>https://raw.githubusercontent.com/metaschema-framework/maven2/refs/heads/main</url>
    <snapshots>
      <enabled>true</enabled>
      <updatePolicy>always</updatePolicy>
    </snapshots>
    <releases>
      <enabled>false</enabled>
    </releases>
  </pluginRepository>
</pluginRepositories>
```

### Gradle Configuration

Add this repository to your `build.gradle` or `build.gradle.kts`:

**Groovy:**
```groovy
repositories {
    maven {
        url = uri("https://raw.githubusercontent.com/metaschema-framework/maven2/refs/heads/main")
        content {
            includeGroup("dev.metaschema")
            includeGroup("dev.metaschema.java")
            includeGroup("dev.metaschema.oscal")
        }
    }
    mavenCentral()
}
```

**Kotlin:**
```kotlin
repositories {
    maven {
        url = uri("https://raw.githubusercontent.com/metaschema-framework/maven2/refs/heads/main")
        content {
            includeGroup("dev.metaschema")
            includeGroup("dev.metaschema.java")
            includeGroup("dev.metaschema.oscal")
        }
    }
    mavenCentral()
}
```

## Available Artifacts

This repository hosts SNAPSHOT builds for the following artifact groups:

| Group ID | Description |
|----------|-------------|
| `dev.metaschema` | Parent POMs and build support |
| `dev.metaschema.java` | Metaschema Java framework modules |
| `dev.metaschema.oscal` | OSCAL Java libraries |

Browse the [`dev/`](./dev) directory to see all available artifacts and versions.

### Example Dependencies

**Metaschema Core:**
```xml
<dependency>
  <groupId>dev.metaschema.java</groupId>
  <artifactId>metaschema-core</artifactId>
  <version>3.0.0.M1-SNAPSHOT</version>
</dependency>
```

**OSCAL Java Library:**
```xml
<dependency>
  <groupId>dev.metaschema.oscal</groupId>
  <artifactId>liboscal-java</artifactId>
  <version>5.3.0-SNAPSHOT</version>
</dependency>
```

## Repository Maintenance

### Automated Pruning

Old SNAPSHOT builds are automatically pruned daily via [GitHub Actions](.github/workflows/prune-snapshots.yml) to manage repository size.

**Retention Policy:**
- All builds from the last **30 days** are retained
- At least **1 build** (the latest) is always kept for each SNAPSHOT version, even if older than 30 days

This ensures that:
1. Recent development work is preserved
2. Older snapshot versions remain usable (with at least their latest build)
3. Repository size stays manageable

### Manual Pruning

To run the pruner locally:

```bash
cd pruner
npm install
npm run build

# Dry run (see what would be deleted without actually deleting)
npm run prune:dry

# Actual pruning
npm run prune
```

### Configuration

Pruning behavior is configured in [`pruner/config.yml`](pruner/config.yml):

```yaml
# Base directory containing Maven artifacts
baseDir: "../dev"

# Retention policy
retention:
  days: 30      # Keep builds from the last N days
  minBuilds: 1  # Always keep at least this many builds

# Logging level: DEBUG, INFO, WARN, ERROR
logLevel: INFO

# Pattern for snapshot directories
snapshotPattern: ".*-SNAPSHOT"
```

## For Maintainers

### How Artifacts Are Published

Artifacts are published to this repository by CI/CD workflows in the source projects (e.g., [metaschema-java](https://github.com/metaschema-framework/metaschema-java)). These workflows:

1. Build the project
2. Deploy artifacts to this repository via Git commits
3. Commits follow the pattern: `[CI SKIP] Deploying artifacts for [group]:[artifact]:[version]`

### Triggering Manual Pruning

You can manually trigger the pruning workflow from the [Actions tab](https://github.com/metaschema-framework/maven2/actions/workflows/prune-snapshots.yml):

1. Click "Run workflow"
2. Optionally enable "Perform a dry run" to preview changes
3. Click "Run workflow"

## Additional Resources

- [Introduction to Maven Repositories](https://maven.apache.org/guides/introduction/introduction-to-repositories.html)
- [Metaschema Framework](https://github.com/metaschema-framework)
- [OSCAL](https://pages.nist.gov/OSCAL/)
