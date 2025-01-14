/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineModuleGetter(
  this,
  "ExtensionParent",
  "resource://gre/modules/ExtensionParent.jsm"
);

ChromeUtils.defineModuleGetter(
  this,
  "TelemetryTestUtils",
  "resource://testing-common/TelemetryTestUtils.jsm"
);

AddonTestUtils.init(this);
AddonTestUtils.overrideCertDB();

AddonTestUtils.createAppInfo(
  "xpcshell@tests.mozilla.org",
  "XPCShell",
  "42",
  "42"
);

const ADDON_ID = "test-startup-cache-telemetry@xpcshell.mozilla.org";

add_setup(async () => {
  // Allows to run this telemetry test also on products (e.g. Thunderbird) where
  // that telemetry wouldn't be actually collected in practice (but to be sure
  // that it will work on those products as well by just adding the product in
  // the telemetry metric definitions if it turns out we want to).
  Services.prefs.setBoolPref(
    "toolkit.telemetry.testing.overrideProductsCheck",
    true
  );

  // FOG needs a profile directory to put its data in.
  do_get_profile();
  // FOG needs to be initialized in order for data to flow.
  Services.fog.initializeFOG();

  await AddonTestUtils.promiseStartupManager();
});

add_task(async function test_startupCache_write_byteLength() {
  const extension = ExtensionTestUtils.loadExtension({
    useAddonManager: "permanent",
    manifest: {
      applications: { gecko: { id: ADDON_ID } },
    },
  });

  await extension.startup();

  const { StartupCache } = ExtensionParent;

  const aomStartup = Cc[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Ci.amIAddonManagerStartup);

  let expectedByteLength = new Uint8Array(
    aomStartup.encodeBlob(StartupCache._data)
  ).byteLength;

  equal(
    typeof expectedByteLength,
    "number",
    "Got a numeric byteLength for the expected startupCache data"
  );
  ok(expectedByteLength > 0, "Got a non-zero byteLength as expected");
  await StartupCache._saveNow();

  let scalars = TelemetryTestUtils.getProcessScalars("parent");
  equal(
    scalars["extensions.startupCache.write_byteLength"],
    expectedByteLength,
    "Got the expected value set in the 'extensions.startupCache.write_byteLength' scalar"
  );

  await extension.unload();
});

add_task(async function test_startupCache_read_errors() {
  const { StartupCache } = ExtensionParent;

  // Clear any pre-existing keyed scalar.
  TelemetryTestUtils.getProcessScalars("parent", /* keyed */ true, true);

  // Temporarily point StartupCache._file to a path that is
  // not going to exist for sure.
  Assert.notEqual(
    StartupCache.file,
    null,
    "Got a StartupCache._file non-null property as expected"
  );
  const oldFile = StartupCache.file;
  const restoreStartupCacheFile = () => (StartupCache.file = oldFile);
  StartupCache.file = `${StartupCache.file}.non_existing_file.${Math.random()}`;
  registerCleanupFunction(restoreStartupCacheFile);

  // Make sure the _readData has been called and we can expect
  // the extensions.startupCache.read_errors scalar to have
  // been recorded.
  await StartupCache._readData();

  let scalars = TelemetryTestUtils.getProcessScalars(
    "parent",
    /* keyed */ true
  );
  Assert.deepEqual(
    scalars["extensions.startupCache.read_errors"],
    {
      NotFoundError: 1,
    },
    "Got the expected value set in the 'extensions.startupCache.read_errors' keyed scalar"
  );

  restoreStartupCacheFile();
});

add_task(async function test_startupCache_load_timestamps() {
  const { StartupCache } = ExtensionParent;

  // Clear any pre-existing keyed scalar.
  TelemetryTestUtils.getProcessScalars("parent", false, true);

  // Make sure the _readData has been called and we can expect
  // the startupCache load telemetry timestamps to have been
  // recorded.
  await StartupCache._readData();

  info(
    "Verify telemetry recorded for the 'extensions.startup_cache_load_time' Glean metric"
  );

  const gleanMetric = Glean.extensions.startupCacheLoadTime.testGetValue();
  equal(
    typeof gleanMetric,
    "number",
    "Expect extensions.startup_cache_load_time Glean metric to be set to a number"
  );

  ok(
    gleanMetric > 0,
    "Expect extensions.startup_cache_load_time Glean metric to be set to a non-zero value"
  );

  info(
    "Verify telemetry mirrored into the 'extensions.startupCache.load_time' scalar"
  );

  const scalars = TelemetryTestUtils.getProcessScalars("parent", false, true);

  equal(
    typeof scalars["extensions.startupCache.load_time"],
    "number",
    "Expect extensions.startupCache.load_time mirrored scalar to be set to a number"
  );

  ok(
    scalars["extensions.startupCache.load_time"] > 0,
    "Expect extensions.startupCache.load_time mirrored scalar to be set to a non-zero value"
  );

  equal(
    scalars["extensions.startupCache.load_time"],
    gleanMetric,
    "Expect the glean metric and mirrored scalar to be set to the same value"
  );
});
