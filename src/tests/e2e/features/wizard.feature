Feature: First configuration wizard
  Scenario: A token the forge refuses is reported before anything is installed
    Given the wizard opens on a NAS never configured
    When I go through the setup wizard up to the token
    And I check the token "refused"
    Then the token is refused by every repository

  Scenario: The wizard downloads the gateway and the launcher, and installs them
    Given the wizard opens on a NAS never configured
    When I go through the setup wizard up to the token
    And I check the token "ghp_token"
    Then every repository can be read with the token
    When I complete the configuration
    Then the wizard downloads both releases and simulates the rest

  Scenario: Going to login keeps the HTTP origin and waits for the gateway
    Given the wizard is ready to hand over to the gateway
    When I choose to go to login
    Then the wizard waits for the gateway and opens login on the same HTTP origin

  Scenario: Old permanent redirects do not survive the wizard handover
    Given the browser has cached the old gateway redirects for root and login
    When I open the current wizard and choose to go to login
    Then login and root keep the forwarded HTTP origin and browser settings
