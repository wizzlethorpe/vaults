// Core's own tests run as the CLI does with no add-on installed. The add-on's tests, in ttrpg/, run with it.
process.env["VAULTS_NO_ADDON"] = "1";
