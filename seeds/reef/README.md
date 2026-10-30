# REEF reference data (fixture only)

These files are **not** migrations and are never applied to staging or production. They exist so the automated tests have a realistic
project and fleet to run against (`createTestDb()` applies them after the migrations). A fresh Nexus installation starts with no
organization, projects, areas, vehicles or any other operational record.
