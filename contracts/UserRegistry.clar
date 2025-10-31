;; UserRegistry.clar
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-ALREADY-REGISTERED (err u101))
(define-constant ERR-INVALID-REPUTATION (err u102))
(define-constant ERR-INVALID-ROLE (err u103))
(define-constant ERR-USER-NOT-FOUND (err u104))
(define-constant ERR-INVALID-EXPERTISE (err u105))
(define-constant ERR-STAKE-REQUIRED (err u106))
(define-constant ERR-INSUFFICIENT-STAKE (err u107))

(define-data-var min-stake-amount uint u5000000)
(define-data-var total-users uint u0)

(define-map Users
  principal
  {
    reputation: uint,
    role: (string-ascii 20),
    expertise-langs: (list 10 (string-ascii 10)),
    total-translated: uint,
    total-verified: uint,
    stake: uint,
    joined-at: uint,
    is-active: bool
  }
)

(define-map UserStakes
  principal
  uint
)

(define-map ExpertiseIndex
  { lang: (string-ascii 10), user: principal }
  bool
)

(define-read-only (get-user (user principal))
  (map-get? Users user)
)

(define-read-only (get-stake (user principal))
  (default-to u0 (map-get? UserStakes user))
)

(define-read-only (get-experts-by-lang (lang (string-ascii 10)))
  (map get-expert-entry
    (filter is-lang-expert
      (map-keys ExpertiseIndex)
    )
  )
)

(define-private (is-lang-expert (key { lang: (string-ascii 10), user: principal }))
  (is-eq (get lang key) lang)
)

(define-private (get-expert-entry (key { lang: (string-ascii 10), user: principal }))
  (some { user: (get user key), lang: (get lang key) })
)

(define-private (valid-role (role (string-ascii 20)))
  (or
    (is-eq role "creator")
    (is-eq role "translator")
    (is-eq role "verifier")
    (is-eq role "all")
  )
)

(define-private (valid-lang (lang (string-ascii 10)))
  (and (> (len lang) u0) (<= (len lang) u10))
)

(define-public (register-user
  (role (string-ascii 20))
  (expertise-langs (list 10 (string-ascii 10)))
)
  (let (
    (user tx-sender)
    (existing (get-user user))
  )
    (asserts! (is-none existing) ERR-ALREADY-REGISTERED)
    (asserts! (valid-role role) ERR-INVALID-ROLE)
    (asserts! (all valid-lang expertise-langs) ERR-INVALID-EXPERTISE)
    (fold register-lang expertise-langs (ok true))
    (map-set Users user
      {
        reputation: u100,
        role: role,
        expertise-langs: expertise-langs,
        total-translated: u0,
        total-verified: u0,
        stake: u0,
        joined-at: block-height,
        is-active: true
      }
    )
    (var-set total-users (+ (var-get total-users) u1))
    (ok true)
  )
)

(define-private (register-lang (lang (string-ascii 10)) (prev (response bool uint)))
  (match prev
    success
      (begin
        (map-set ExpertiseIndex { lang: lang, user: tx-sender } true)
        (ok true)
      )
    err-val (err err-val)
  )
)

(define-public (stake-for-role (amount uint))
  (let (
    (user tx-sender)
    (current-stake (get-stake user))
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
  )
    (asserts! (> amount u0) ERR-INSUFFICIENT-STAKE)
    (try! (stx-transfer? amount user (as-contract tx-sender)))
    (map-set UserStakes user (+ current-stake amount))
    (map-set Users user
      (merge user-data { stake: (+ (get stake user-data) amount) })
    )
    (ok (+ current-stake amount))
  )
)

(define-public (update-reputation (user principal) (delta int))
  (let (
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
    (new-rep (+ (get reputation user-data) (if (>= delta 0) (int-to-uint delta) u0)))
    (final-rep (if (< delta 0) (if (>= (get reputation user-data) (uint-to-int (- delta))) new-rep u0) new-rep))
  )
    (asserts! (is-eq (as-contract tx-sender) tx-sender) ERR-NOT-AUTHORIZED)
    (map-set Users user
      (merge user-data { reputation: final-rep })
    )
    (ok final-rep)
  )
)

(define-public (deactivate-user)
  (let (
    (user tx-sender)
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
    (stake (get-stake user))
  )
    (map-set Users user
      (merge user-data { is-active: false })
    )
    (try! (as-contract (stx-transfer? stake tx-sender user)))
    (map-delete UserStakes user)
    (ok true)
  )
)

(define-public (update-expertise (new-langs (list 10 (string-ascii 10))))
  (let (
    (user tx-sender)
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
    (old-langs (get expertise-langs user-data))
  )
    (asserts! (all valid-lang new-langs) ERR-INVALID-EXPERTISE)
    (fold remove-old-lang old-langs (ok true))
    (fold register-lang new-langs (ok true))
    (map-set Users user
      (merge user-data { expertise-langs: new-langs })
    )
    (ok true)
  )
)

(define-private (remove-old-lang (lang (string-ascii 10)) (prev (response bool uint)))
  (match prev
    success
      (begin
        (map-delete ExpertiseIndex { lang: lang, user: tx-sender })
        (ok true)
      )
    err-val (err err-val)
  )
)

(define-public (increment-translated (user principal))
  (let (
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
  )
    (map-set Users user
      (merge user-data { total-translated: (+ (get total-translated user-data) u1) })
    )
    (ok true)
  )
)

(define-public (increment-verified (user principal))
  (let (
    (user-data (unwrap! (get-user user) ERR-USER-NOT-FOUND))
  )
    (map-set Users user
      (merge user-data { total-verified: (+ (get total-verified user-data) u1) })
    )
    (ok true)
  )
)