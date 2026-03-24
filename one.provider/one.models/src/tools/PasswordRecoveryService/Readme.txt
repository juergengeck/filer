How to use those scripts:

1) create an identity for the password recovery service
> node lib/tools/identity/GenerateIdentity.js pw http://localhost:8080
Created files:
pw_secret.id.json
pw.id.json

2) start the password recovery server
> node lib/tools/PasswordRecoveryService/PasswordRecoveryServer.js

3) make a request with the client
> node lib/tools/PasswordRecoveryService/PasswordRecoveryClient_newRequest.js mysecret me@test.invalid

4) look in the output folder for a file with the highest timestamp and open the file
> ls passwordRecoveryRequests/
1646302230854

> cat passwordRecoveryRequests/1646302230854
{"identity":"me@test.invalid","symmetricKey":"f8e763ddb925e4b86fb4d0c48ab02417787fcf84b35676e96e1ab28a2d57f503"}

5) Use the syymetric key to restore the secret
> node lib/tools/PasswordRecoveryService/PasswordRecoveryClient_recoverSecret.js f8e763ddb925e4b86fb4d0c48ab02417787fcf84b35676e96e1ab28a2d57f503
The recovered secret is: mysecret
